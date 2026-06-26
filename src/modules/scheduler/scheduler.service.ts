import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_NAMES, JOB_NAMES, QUEUE_DEFAULT_OPTIONS } from '../queue/queue.constants';
import { MarketplaceSource } from '../../database/entities/order.entity';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.ORDERS)
    private readonly ordersQueue: Queue,
    @InjectQueue(QUEUE_NAMES.INVENTORY)
    private readonly inventoryQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PRICING)
    private readonly pricingQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RETRY)
    private readonly retryQueue: Queue,
  ) {}

  /**
   * Fetch new marketplace orders from Amazon and Flipkart.
   * Default: every 15 minutes (configurable via CRON_FETCH_ORDERS env).
   */
  @Cron(process.env.CRON_FETCH_ORDERS || '*/15 * * * *', {
    name: 'fetch-marketplace-orders',
  })
  async fetchMarketplaceOrders(): Promise<void> {
    this.logger.log('CRON: Fetching marketplace orders...');
    const fromDate = new Date(Date.now() - 30 * 60 * 1000); // last 30 minutes

    await Promise.all([
      this.ordersQueue.add(
        JOB_NAMES.FETCH_MARKETPLACE_ORDERS,
        { source: MarketplaceSource.AMAZON, fromDate },
        QUEUE_DEFAULT_OPTIONS,
      ),
      this.ordersQueue.add(
        JOB_NAMES.FETCH_MARKETPLACE_ORDERS,
        { source: MarketplaceSource.FLIPKART, fromDate },
        QUEUE_DEFAULT_OPTIONS,
      ),
    ]);

    this.logger.log('CRON: Order fetch jobs queued for Amazon and Flipkart');
  }

  /**
   * Sync inventory from ERPNext to all marketplaces.
   * Default: every 30 minutes (configurable via CRON_SYNC_INVENTORY env).
   */
  @Cron(process.env.CRON_SYNC_INVENTORY || '*/30 * * * *', {
    name: 'sync-inventory',
  })
  async syncInventory(): Promise<void> {
    this.logger.log('CRON: Syncing inventory to marketplaces...');

    await this.inventoryQueue.add(
      JOB_NAMES.SYNC_INVENTORY_TO_MARKETPLACE,
      { source: null }, // null = sync to all marketplaces
      QUEUE_DEFAULT_OPTIONS,
    );

    this.logger.log('CRON: Inventory sync job queued');
  }

  /**
   * Sync prices from ERPNext to all marketplaces.
   * Default: every hour (configurable via CRON_SYNC_PRICES env).
   */
  @Cron(process.env.CRON_SYNC_PRICES || '0 * * * *', {
    name: 'sync-prices',
  })
  async syncPrices(): Promise<void> {
    this.logger.log('CRON: Syncing prices to marketplaces...');

    await this.pricingQueue.add(
      JOB_NAMES.SYNC_PRICES_TO_MARKETPLACE,
      { source: null }, // null = sync to all marketplaces
      QUEUE_DEFAULT_OPTIONS,
    );

    this.logger.log('CRON: Price sync job queued');
  }

  /**
   * Retry failed synchronization jobs.
   * Default: every 10 minutes (configurable via CRON_RETRY_FAILED env).
   */
  @Cron(process.env.CRON_RETRY_FAILED || '*/10 * * * *', {
    name: 'retry-failed',
  })
  async retryFailedJobs(): Promise<void> {
    this.logger.log('CRON: Retrying failed jobs...');

    await this.retryQueue.add(
      JOB_NAMES.RETRY_FAILED_JOB,
      {},
      {
        ...QUEUE_DEFAULT_OPTIONS,
        attempts: 1, // retry processor itself should not retry
      },
    );

    this.logger.log('CRON: Retry job queued');
  }
}
