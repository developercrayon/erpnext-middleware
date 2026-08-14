import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, Between } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Order, MarketplaceSource, OrderStatus, SyncStatus } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { WebhookLog, ApiLog } from '../../database/entities/logs.entity';
import { QueueJob, QueueJobStatus } from '../../database/entities/operational.entity';
import { NormalizedOrder } from '../connectors/base/connector.types';
import { OrderQueryDto } from './dto/order.dto';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { generateCorrelationId } from '../../utils/crypto.util';
import { Product } from '../../database/entities/product.entity';
import { AmazonConnector } from '../connectors/amazon/amazon.connector';
import { ERPNextConnector } from '../connectors/erpnext/erpnext.connector';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(WebhookLog)
    private readonly webhookLogRepo: Repository<WebhookLog>,
    @InjectRepository(ApiLog)
    private readonly apiLogRepo: Repository<ApiLog>,
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectQueue(QUEUE_NAMES.ORDERS)
    private readonly ordersQueue: Queue,
    private readonly amazonConnector: AmazonConnector,
    private readonly erpNextConnector: ERPNextConnector,
  ) { }

  // ─── Webhook Ingestion ────────────────────────────────────────────────────

  /**
   * Ingests a raw webhook payload from a marketplace:
   * 1. Saves the raw webhook log
   * 2. Normalizes and upserts the order
   * 3. Queues a BullMQ job for ERPNext sync
   */
  async ingestWebhook(
    source: MarketplaceSource,
    rawPayload: Record<string, any>,
    eventType: string,
    signatureValid: boolean,
  ): Promise<{ orderId: string; jobId: string }> {
    const correlationId = generateCorrelationId();

    // Save raw webhook log
    const webhookLog = await this.webhookLogRepo.save({
      source,
      eventType,
      rawPayload,
      signatureValid,
      processed: false,
    });

    // For order events, enqueue processing
    const job = await this.ordersQueue.add(
      'process-webhook-order',
      {
        source,
        rawPayload,
        eventType,
        webhookLogId: webhookLog.id,
        correlationId,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.ORDERS,
        jobName: 'process-webhook-order',
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: 3,
      });
    } catch (e) {
      // Ignore unique constraint violation
    }

    this.logger.log(
      `Webhook queued: source=${source} event=${eventType} jobId=${job.id} correlationId=${correlationId}`,
    );

    return { orderId: webhookLog.id, jobId: String(job.id) };
  }

  /**
   * Saves or updates an order from a normalized marketplace order object.
   */
  async upsertOrder(normalized: NormalizedOrder): Promise<Order> {
    let order = await this.orderRepo.findOne({
      where: {
        marketplaceOrderId: normalized.marketplaceOrderId,
        source: normalized.source,
      },
    });

    let isNewOrder = false;

    if (!order) {
      order = this.orderRepo.create();
      isNewOrder = true;
    }

    order.marketplaceOrderId = normalized.marketplaceOrderId;
    order.source = normalized.source;
    order.customerName = normalized.customerName;
    order.customerEmail = normalized.customerEmail;
    order.customerPhone = normalized.customerPhone;
    order.shippingAddress = normalized.shippingAddress as any;
    order.billingAddress = normalized.billingAddress as any;
    order.subtotal = normalized.subtotal;
    order.discount = normalized.discount || 0;
    order.tax = normalized.tax || 0;
    order.shippingCharge = normalized.shippingCharge || 0;
    order.total = normalized.total;
    order.currency = normalized.currency;
    order.paymentMethod = normalized.paymentMethod;
    order.paymentStatus = normalized.paymentStatus;
    order.marketplaceOrderDate = normalized.orderDate;
    order.promisedDeliveryDate = normalized.promisedDeliveryDate;
    order.rawPayload = normalized.rawPayload;
    order.syncStatus = SyncStatus.PENDING;

    const savedOrder = await this.orderRepo.save(order);

    // Upsert order items
    if (normalized.items?.length) {
      await this.orderItemRepo.delete({ orderId: savedOrder.id });
      const items = normalized.items.map((item) =>
        this.orderItemRepo.create({
          orderId: savedOrder.id,
          ...item,
        }),
      );
      await this.orderItemRepo.save(items);
    }

    if (isNewOrder) {
      const webhookUrl = process.env.DISCORD_WEBHOOK;
      if (webhookUrl) {
        try {
          const sourceName = normalized.source === MarketplaceSource.AMAZON ? 'Amazon' : (normalized.source === MarketplaceSource.FLIPKART ? 'Flipkart' : normalized.source);
          const raw = normalized.rawPayload || {};
          let deliveryDate = 'N/A';
          let shipDate = 'N/A';

          if (normalized.source === 'AMAZON') {
            const rawDeliveryDate = raw.fulfillment?.deliverByWindow?.latestDateTime || raw.LatestDeliveryDate;
            deliveryDate = rawDeliveryDate ? new Date(rawDeliveryDate).toLocaleDateString() : (normalized.promisedDeliveryDate ? new Date(normalized.promisedDeliveryDate).toLocaleDateString() : 'N/A');
            shipDate = raw.LatestShipDate ? new Date(raw.LatestShipDate).toLocaleDateString() : 'N/A';
          } else {
            deliveryDate = normalized.promisedDeliveryDate ? new Date(normalized.promisedDeliveryDate).toLocaleDateString() : 'N/A';
            shipDate = 'N/A';
          }

          const rawAddr = raw.ShippingAddress || raw.recipient?.deliveryAddress || {};
          const addr: any = normalized.shippingAddress || {};
          const custAddressParts = [
            rawAddr.addressLine1 || rawAddr.AddressLine1 || addr?.line1,
            rawAddr.addressLine2 || rawAddr.AddressLine2 || addr?.line2,
            rawAddr.city || rawAddr.City || addr?.city,
            rawAddr.stateOrRegion || rawAddr.StateOrRegion || addr?.state,
            rawAddr.districtOrCounty,
            rawAddr.postalCode || rawAddr.PostalCode || addr?.pincode,
            rawAddr.phone || rawAddr.Phone
          ].filter(Boolean);
          const custAddress = custAddressParts.length > 0 ? custAddressParts.join(', ') : 'N/A';

          const customerName = raw.buyer?.buyerName || rawAddr.Name || normalized.customerName || raw.BuyerInfo?.BuyerName || 'Amazon Buyer';

          let orderTotalAmount = raw.proceeds?.grandTotal?.amount ?? raw.OrderTotal?.Amount;
          if (orderTotalAmount === undefined || orderTotalAmount === null) {
            orderTotalAmount = normalized.total || 0;
          }
          const orderTotalCurrency = raw.proceeds?.grandTotal?.currencyCode || raw.OrderTotal?.CurrencyCode || normalized.currency || 'INR';
          const orderTotal = `${orderTotalAmount} ${orderTotalCurrency}`;

          const purchaseDate = raw.PurchaseDate ? new Date(raw.PurchaseDate).toLocaleString() : (normalized.orderDate ? new Date(normalized.orderDate).toLocaleString() : 'N/A');

          let productsString = '';
          const embeds = [];
          for (const item of (normalized.items || [])) {
            const rawItem = item.rawPayload || {};
            let itemPriceAmount = rawItem.product?.price?.unitPrice?.amount ?? rawItem.product?.price?.untiPrice?.amount ?? rawItem.ItemPrice?.Amount;
            if (itemPriceAmount === undefined || itemPriceAmount === null) {
              itemPriceAmount = (!isNaN(item.unitPrice) && isFinite(item.unitPrice)) ? item.unitPrice : 0;
            }
            const itemPriceCurrency = rawItem.product?.price?.unitPrice?.currencyCode || rawItem.product?.price?.untiPrice?.currencyCode || rawItem.ItemPrice?.CurrencyCode || orderTotalCurrency;

            productsString += `> **Product Name :** ${item.productName}\n> **Product SKU :** ${item.sku}\n> **Quantity :** ${item.quantity}\n> **Item Price :** ${itemPriceAmount} ${itemPriceCurrency}\n\n`;

            try {
              const product = await this.productRepo.findOne({ where: { sku: item.sku } });
              if (product) {
                const raw = product.erpnextRawPayload || {};
                let thumb = raw.custom_thumbnail_image || raw.image;
                if (!thumb && raw.attachments && raw.attachments.length > 0) {
                  thumb = raw.attachments[0]?.file_url;
                }
                if (thumb) {
                  const clean = thumb.startsWith('/') ? thumb.substring(1) : thumb;
                  const baseUrl = process.env.ERPNEXT_BASE_URL || '';
                  thumb = clean.startsWith('http') ? clean : `${baseUrl}/${clean}`;
                  embeds.push({
                    title: item.productName.substring(0, 256),
                    description: `SKU: ${item.sku} | Qty: ${item.quantity}\nPrice: ${itemPriceAmount} ${itemPriceCurrency}`,
                    thumbnail: { url: thumb },
                    color: 0x3498db
                  });
                }
              }
            } catch (err) {
              // Ignore db error for thumbnail lookup
            }
          }
          if (!productsString) productsString = '> No items found';

          const payload = {
            content: `🛍️ **New ${sourceName} Order Created!**\n\n**Order Details**\n> **Order ID :** ${normalized.marketplaceOrderId}\n> **Purchase Date :** ${purchaseDate}\n> **Delivery Date :** ${deliveryDate}\n> **Ship Date :** ${shipDate}\n> **Order Total :** ${orderTotal}\n\n**Customer Shipping Details** \n> **Customer Name :** ${customerName}\n> **Customer Address :** ${custAddress}\n\n**Product Details**\n${productsString}`,
            embeds: embeds.length > 0 ? embeds.slice(0, 10) : undefined
          };
          const start = Date.now();

          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const durationMs = Date.now() - start;
          await this.apiLogRepo.save({
            service: 'DiscordWebhook',
            method: 'POST',
            url: webhookUrl,
            responseStatus: response.status,
            durationMs,
          });
          await this.webhookLogRepo.save({
            source: 'DISCORD_OUTGOING',
            eventType: 'ORDER_NOTIFICATION',
            rawPayload: payload,
            processed: response.ok,
            processingError: response.ok ? null : `Failed with status ${response.status}`,
            signatureValid: true
          });
          this.logger.log(`Successfully sent Discord webhook for new ${sourceName} order ${savedOrder.marketplaceOrderId}`);
        } catch (e: any) {
          const payload = {
            content: `🛍️ **New ${normalized.source} Order Created!**\n**Order ID:** ${savedOrder.marketplaceOrderId}`
          };
          await this.apiLogRepo.save({
            service: 'DiscordWebhook',
            method: 'POST',
            url: webhookUrl,
            error: e.message,
          });
          await this.webhookLogRepo.save({
            source: 'DISCORD_OUTGOING',
            eventType: 'ORDER_NOTIFICATION',
            rawPayload: payload,
            processed: false,
            processingError: e.message,
            signatureValid: true
          });
          this.logger.error(`Failed to trigger Discord webhook: ${e.message}`);
        }
      }
    }

    return savedOrder;
  }

  // ─── Query Methods ────────────────────────────────────────────────────────

  async findAll(query: OrderQueryDto): Promise<{ data: Order[]; total: number }> {
    const { source, status, syncStatus, fromDate, toDate, page = 1, pageSize = 20 } = query;

    const where: any = {};
    if (source) where.source = source;
    if (status) where.status = status;
    if (syncStatus) where.syncStatus = syncStatus;

    const options: FindManyOptions<Order> = {
      where,
      relations: ['items'],
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    if (fromDate && toDate) {
      options.where = { ...where, createdAt: Between(new Date(fromDate), new Date(toDate)) };
    }

    const [data, total] = await this.orderRepo.findAndCount(options);
    return { data, total };
  }

  async findById(id: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id }, relations: ['items'] });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async findByMarketplaceId(marketplaceOrderId: string): Promise<Order | null> {
    return this.orderRepo.findOne({ where: { marketplaceOrderId }, relations: ['items'] });
  }

  // ─── Sync Status Management ───────────────────────────────────────────────

  async markSynced(id: string, erpnextSalesOrderId: string): Promise<void> {
    await this.orderRepo.update(id, {
      syncStatus: SyncStatus.SYNCED,
      erpnextSalesOrderId,
      status: OrderStatus.CONFIRMED,
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) return;
    await this.orderRepo.update(id, {
      syncStatus: SyncStatus.FAILED,
      lastError: error,
      retryCount: (order.retryCount || 0) + 1,
    });
  }

  async markInProgress(id: string): Promise<void> {
    await this.orderRepo.update(id, { syncStatus: SyncStatus.IN_PROGRESS });
  }

  async getFailedOrders(limit = 50): Promise<Order[]> {
    return this.orderRepo.find({
      where: { syncStatus: SyncStatus.FAILED },
      take: limit,
      order: { createdAt: 'ASC' },
    });
  }

  async requeueOrder(orderId: string): Promise<any> {
    const order = await this.findById(orderId);
    
    // Check if it already exists in ERPNext
    const existingOrderResult = await this.erpNextConnector.getSalesOrderByMarketplaceId(order.marketplaceOrderId);
    if (existingOrderResult.success && existingOrderResult.data) {
      await this.markSynced(order.id, existingOrderResult.data.name);
      return { 
        status: 'already_synced', 
        message: 'Already synced into ERPNext', 
        erpnextSalesOrderId: existingOrderResult.data.name 
      };
    }

    const job = await this.ordersQueue.add(
      'sync-order-to-erpnext',
      { orderId: order.id, source: order.source },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.ORDERS,
        jobName: 'sync-order-to-erpnext',
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: 3,
      });
    } catch (e) {
      // Ignore
    }

    await this.markInProgress(order.id);
    return { 
      status: 'queued', 
      message: 'Added into queue & proceed for sync next', 
      jobId: String(job.id) 
    };
  }

  async triggerFetchOrders(source: MarketplaceSource, fromDate?: Date): Promise<string> {
    const job = await this.ordersQueue.add(
      'fetch-marketplace-orders',
      { source, fromDate: fromDate || new Date(Date.now() - 24 * 60 * 60 * 1000) },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    );

    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.ORDERS,
        jobName: 'fetch-marketplace-orders',
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: 3,
      });
    } catch (e) {
      // Ignore
    }

    this.logger.log(`Manual order fetch queued for ${source}: jobId=${job.id}`);
    return String(job.id);
  }

  async fetchSingleFromAmazonAndStore(orderId: string): Promise<any> {
    const result = await this.amazonConnector.fetchSingleOrder(orderId);
    if (!result.success || !result.data) {
      throw new Error(`Failed to fetch order ${orderId} from Amazon: ${result.error || 'No data'}`);
    }

    const fetchedOrder = result.data;
    
    // Find existing order in DB
    const order = await this.orderRepo.findOne({ where: { marketplaceOrderId: orderId } });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found in database to update.`);
    }

    order.rawPayload = fetchedOrder;
    await this.orderRepo.save(order);

    return order;
  }

  async getStats(): Promise<Record<string, number>> {
    const total = await this.orderRepo.count();
    const pending = await this.orderRepo.count({ where: { syncStatus: SyncStatus.PENDING } });
    const synced = await this.orderRepo.count({ where: { syncStatus: SyncStatus.SYNCED } });
    const failed = await this.orderRepo.count({ where: { syncStatus: SyncStatus.FAILED } });
    const amazon = await this.orderRepo.count({ where: { source: MarketplaceSource.AMAZON } });
    const flipkart = await this.orderRepo.count({ where: { source: MarketplaceSource.FLIPKART } });

    return { total, pending, synced, failed, amazon, flipkart };
  }
}
