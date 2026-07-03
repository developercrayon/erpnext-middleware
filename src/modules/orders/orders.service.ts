import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, Between } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Order, MarketplaceSource, OrderStatus, SyncStatus } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { WebhookLog } from '../../database/entities/logs.entity';
import { QueueJob, QueueJobStatus } from '../../database/entities/operational.entity';
import { NormalizedOrder } from '../connectors/base/connector.types';
import { OrderQueryDto } from './dto/order.dto';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { generateCorrelationId } from '../../utils/crypto.util';

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
    @InjectQueue(QUEUE_NAMES.ORDERS)
    private readonly ordersQueue: Queue,
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
  ) {}

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

    if (!order) {
      order = this.orderRepo.create();
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

  async requeueOrder(orderId: string): Promise<string> {
    const order = await this.findById(orderId);
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
    return String(job.id);
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
