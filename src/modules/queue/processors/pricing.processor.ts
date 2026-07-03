import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { ERPNextService } from '../../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../connectors/flipkart/flipkart.connector';
import { SyncHistory, SyncResourceType, ItemSyncLog } from '../../../database/entities/operational.entity';
import { MarketplaceSource } from '../../../database/entities/order.entity';
import { ErrorLog } from '../../../database/entities/logs.entity';

@Processor(QUEUE_NAMES.PRICING)
export class PricingProcessor {
  private readonly logger = new Logger(PricingProcessor.name);

  constructor(
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectRepository(ItemSyncLog)
    private readonly itemSyncLogRepo: Repository<ItemSyncLog>,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
  ) {}

  @Process(JOB_NAMES.SYNC_PRICES_TO_MARKETPLACE)
  async syncPricesToMarketplace(job: Job): Promise<void> {
    const { source, skus } = job.data;
    this.logger.log(`Syncing prices to ${source || 'all'} marketplaces`);

    // Fetch prices from ERPNext
    const priceMap = await this.erpnextService.getPricesForSkus(skus || []);

    if (!Object.keys(priceMap).length) {
      this.logger.warn('No price data found in ERPNext');
      return;
    }

    const priceItems = Object.entries(priceMap).map(([sku, price]) => ({
      sku,
      sellingPrice: price,
      currency: 'INR',
    }));

    const marketplaces = source
      ? [source]
      : [MarketplaceSource.AMAZON, MarketplaceSource.FLIPKART];

    for (const mp of marketplaces) {
      const connector =
        mp === MarketplaceSource.AMAZON ? this.amazonConnector : this.flipkartConnector;

      for (const item of priceItems) {
        await this.itemSyncLogRepo.save({
          resourceType: SyncResourceType.PRICE,
          referenceId: item.sku,
          source: mp,
          syncStatus: 'IN_PROGRESS',
          details: { priceAfter: item.sellingPrice }
        });
      }

      try {
        const result = await connector.updatePrice(priceItems);

        for (const item of priceItems) {
          await this.itemSyncLogRepo.update(
            { resourceType: SyncResourceType.PRICE, referenceId: item.sku, source: mp, syncStatus: 'IN_PROGRESS' },
            {
              syncStatus: result.success ? 'SYNCED' : 'FAILED',
              syncedAt: new Date(),
              errorMessage: result.success ? null : result.error,
            }
          );
        }

        this.logger.log(
          `Prices synced to ${mp}: ${result.data?.success}/${result.data?.total} items`,
        );
      } catch (error) {
        for (const item of priceItems) {
          await this.itemSyncLogRepo.update(
            { resourceType: SyncResourceType.PRICE, referenceId: item.sku, source: mp, syncStatus: 'IN_PROGRESS' },
            {
              syncStatus: 'FAILED',
              errorMessage: error.message,
            }
          );
        }
        throw error;
      }
    }
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(`Pricing job ${job.id} failed: ${error.message}`);
    await this.errorLogRepo.save({
      source: QUEUE_NAMES.PRICING,
      context: job.name,
      message: error.message,
      stackTrace: error.stack,
      payload: job.data,
    });
  }
}
