import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

import { ERPNextService } from '../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../connectors/flipkart/flipkart.connector';
import { QUEUE_NAMES, JOB_NAMES, QUEUE_DEFAULT_OPTIONS } from '../queue/queue.constants';
import { MarketplaceSource } from '../../database/entities/order.entity';
import { PricingSyncQueryDto } from './dto/pricing.dto';

import { QueueJob, QueueJobStatus, ItemSyncLog, SyncResourceType } from '../../database/entities/operational.entity';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @InjectRepository(ItemSyncLog)
    private readonly priceSyncRepo: Repository<ItemSyncLog>,
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectQueue(QUEUE_NAMES.PRICING)
    private readonly pricingQueue: Queue,
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
  ) {}

  // ─── Query Methods ────────────────────────────────────────────────────────

  async findAll(query: PricingSyncQueryDto): Promise<{ data: ItemSyncLog[]; total: number }> {
    const { source, sku, page = 1, pageSize = 20 } = query;

    const where: any = { resourceType: SyncResourceType.PRICE };
    if (source) where.source = source;
    if (sku) where.referenceId = sku;

    const options: FindManyOptions<ItemSyncLog> = {
      where,
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    const [data, total] = await this.priceSyncRepo.findAndCount(options);
    return { data, total };
  }

  // ─── Sync Trigger ─────────────────────────────────────────────────────────

  async triggerSync(source?: MarketplaceSource, skus?: string[], priceList?: string): Promise<string> {
    const job = await this.pricingQueue.add(
      JOB_NAMES.SYNC_PRICES_TO_MARKETPLACE,
      { source, skus, priceList },
      QUEUE_DEFAULT_OPTIONS,
    );
    
    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.PRICING,
        jobName: JOB_NAMES.SYNC_PRICES_TO_MARKETPLACE,
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: job.opts?.attempts || 3,
      });
    } catch (e) {}

    this.logger.log(`Pricing sync job queued: ${job.id}`);
    return String(job.id);
  }

  // ─── Direct API Interaction ───────────────────────────────────────────────

  /**
   * Refreshes prices from ERPNext immediately and returns the price map.
   */
  async refreshFromERPNext(skus: string[], priceList?: string): Promise<Record<string, number>> {
    const priceMap = await this.erpnextService.getPricesForSkus(skus, priceList);
    return priceMap;
  }

  /**
   * Pushes prices from ERPNext directly to a marketplace (online call, no queue).
   */
  async pushToMarketplace(
    source: MarketplaceSource,
    skus: string[],
    priceList?: string,
  ): Promise<{ success: number; failed: number }> {
    const priceMap = await this.refreshFromERPNext(skus, priceList);

    const items = Object.entries(priceMap).map(([sku, price]) => ({
      sku,
      sellingPrice: price,
      currency: 'INR',
    }));

    if (!items.length) {
      return { success: 0, failed: 0 };
    }

    const connector =
      source === MarketplaceSource.AMAZON ? this.amazonConnector : this.flipkartConnector;

    const result = await connector.updatePrice(items);
    return {
      success: result.data?.success || 0,
      failed: result.data?.failed || 0,
    };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(): Promise<Record<string, any>> {
    const totalSyncs = await this.priceSyncRepo.count({ where: { resourceType: SyncResourceType.PRICE } });
    const amazon = await this.priceSyncRepo.count({
      where: { source: MarketplaceSource.AMAZON, resourceType: SyncResourceType.PRICE },
    });
    const flipkart = await this.priceSyncRepo.count({
      where: { source: MarketplaceSource.FLIPKART, resourceType: SyncResourceType.PRICE },
    });
    const failed = await this.priceSyncRepo.count({
      where: { syncStatus: 'FAILED', resourceType: SyncResourceType.PRICE },
    });

    return { totalSyncs, amazon, flipkart, failed };
  }
}
