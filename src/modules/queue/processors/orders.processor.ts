import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { OrdersService } from '../../orders/orders.service';
import { ERPNextService } from '../../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../connectors/flipkart/flipkart.connector';
import { MarketplaceSource } from '../../../database/entities/order.entity';
import { QueueJob, QueueJobStatus } from '../../../database/entities/operational.entity';
import { ErrorLog } from '../../../database/entities/logs.entity';

@Processor(QUEUE_NAMES.ORDERS)
export class OrdersProcessor {
  private readonly logger = new Logger(OrdersProcessor.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
  ) {}

  // ─── Webhook Order Processing ─────────────────────────────────────────────

  @Process(JOB_NAMES.PROCESS_WEBHOOK_ORDER)
  async processWebhookOrder(job: Job): Promise<void> {
    const { source, rawPayload, eventType, correlationId } = job.data;
    this.logger.log(
      `Processing webhook order: source=${source} event=${eventType} correlationId=${correlationId}`,
    );

    const connector =
      source === MarketplaceSource.AMAZON ? this.amazonConnector : this.flipkartConnector;

    // Normalize and upsert order
    const ordersResult = await connector.fetchOrders();
    // For webhook, normalize the raw payload directly
    // The connector should ideally have a normalizeRaw method; here we queue a full sync
    await this.syncOrdersFromMarketplace(source, connector);
  }

  // ─── Sync Orders from Marketplace ────────────────────────────────────────

  @Process(JOB_NAMES.FETCH_MARKETPLACE_ORDERS)
  async fetchAndSyncMarketplaceOrders(job: Job): Promise<void> {
    const { source, fromDate } = job.data;
    this.logger.log(`Fetching orders from ${source}`);

    const connector =
      source === MarketplaceSource.AMAZON ? this.amazonConnector : this.flipkartConnector;

    let effectiveFromDate = fromDate;
    const stats = await this.ordersService.getStats();
    
    if (source === MarketplaceSource.AMAZON && stats.amazon === 0) {
      effectiveFromDate = new Date('2020-01-01T00:00:00Z'); // Fetch all if empty
      this.logger.log(`No existing Amazon orders found. Fetching all orders.`);
    } else if (source === MarketplaceSource.FLIPKART && stats.flipkart === 0) {
      effectiveFromDate = new Date('2020-01-01T00:00:00Z'); // Fetch all if empty
      this.logger.log(`No existing Flipkart orders found. Fetching all orders.`);
    }

    await this.syncOrdersFromMarketplace(source, connector, effectiveFromDate);
  }

  private async syncOrdersFromMarketplace(
    source: MarketplaceSource,
    connector: any,
    fromDate?: Date,
  ): Promise<void> {
    let nextToken: string | undefined;
    let page = 0;

    do {
      const parsedFromDate = fromDate ? new Date(fromDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = await connector.fetchOrders({
        fromDate: parsedFromDate,
        nextToken,
        pageSize: 50,
      });

      if (!result.success) {
        throw new Error(`Failed to fetch orders from ${source}: ${result.error}`);
      }

      const orders = result.data?.items || [];
      this.logger.log(`Fetched ${orders.length} orders from ${source} (page ${++page})`);

      for (const normalizedOrder of orders) {
        const order = await this.ordersService.upsertOrder(normalizedOrder);
        // Queue individual sync to ERPNext
        await this.syncSingleOrderToERPNext(order.id, source);
      }

      nextToken = result.data?.nextToken;
    } while (nextToken);
  }

  // ─── Sync Single Order to ERPNext ─────────────────────────────────────────

  @Process(JOB_NAMES.SYNC_ORDER_TO_ERPNEXT)
  async syncOrderToERPNext(job: Job): Promise<void> {
    const { orderId, source } = job.data;
    await this.syncSingleOrderToERPNext(orderId, source);
  }

  private async syncSingleOrderToERPNext(
    orderId: string,
    source: MarketplaceSource,
  ): Promise<void> {
    await this.ordersService.markInProgress(orderId);
    const order = await this.ordersService.findById(orderId);

    try {
      // Build normalized order from saved entity for ERPNext sync
      const normalizedOrder = {
        marketplaceOrderId: order.marketplaceOrderId,
        source: order.source,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        shippingAddress: order.shippingAddress as any,
        items: order.items.map((i) => ({
          sku: i.sku,
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          total: Number(i.total),
        })),
        subtotal: Number(order.subtotal),
        total: Number(order.total),
        currency: order.currency,
        orderDate: order.marketplaceOrderDate || order.createdAt,
        promisedDeliveryDate: order.promisedDeliveryDate,
      };

      const erpnextSoId = await this.erpnextService.syncOrderToERPNext(normalizedOrder);
      await this.ordersService.markSynced(orderId, erpnextSoId);
      this.logger.log(`Order ${orderId} synced to ERPNext: SO ${erpnextSoId}`);
    } catch (error) {
      await this.ordersService.markFailed(orderId, error.message);
      throw error; // Re-throw to trigger BullMQ retry
    }
  }

  // ─── Cancel Order ─────────────────────────────────────────────────────────

  @Process(JOB_NAMES.CANCEL_ORDER)
  async cancelOrder(job: Job): Promise<void> {
    const { orderId, marketplaceOrderId, source, reason } = job.data;
    this.logger.log(`Cancelling order ${marketplaceOrderId} on ${source}`);

    const connector =
      source === MarketplaceSource.AMAZON ? this.amazonConnector : this.flipkartConnector;

    const result = await connector.cancelOrder(marketplaceOrderId, reason);
    if (!result.success) {
      throw new Error(`Failed to cancel order: ${result.error}`);
    }

    if (orderId) {
      const order = await this.ordersService.findById(orderId);
      if (order.erpnextSalesOrderId) {
        await this.erpnextService.cancelSalesOrder(order.erpnextSalesOrderId);
      }
    }
  }

  // ─── Queue Event Handlers ─────────────────────────────────────────────────

  @OnQueueCompleted()
  async onCompleted(job: Job): Promise<void> {
    this.logger.debug(`Job ${job.id} (${job.name}) completed`);
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(
      `Job ${job.id} (${job.name}) failed after ${job.attemptsMade} attempts: ${error.message}`,
    );

    // Persist error to DB
    await this.errorLogRepo.save({
      source: QUEUE_NAMES.ORDERS,
      context: job.name,
      message: error.message,
      stackTrace: error.stack,
      payload: job.data,
    });
  }
}
