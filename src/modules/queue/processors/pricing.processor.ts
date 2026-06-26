import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { ERPNextService } from '../../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../connectors/flipkart/flipkart.connector';
import { PriceSync } from '../../../database/entities/sync.entity';
import { MarketplaceSource } from '../../../database/entities/order.entity';
import { ErrorLog } from '../../../database/entities/logs.entity';

@Processor(QUEUE_NAMES.PRICING)
export class PricingProcessor {
  private readonly logger = new Logger(PricingProcessor.name);

  constructor(
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectRepository(PriceSync)
    private readonly priceSyncRepo: Repository<PriceSync>,
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

      const syncLog = await this.priceSyncRepo.save({
        sku: 'batch',
        source: mp,
        syncStatus: 'IN_PROGRESS',
      });

      try {
        const result = await connector.updatePrice(priceItems);

        await this.priceSyncRepo.update(syncLog.id, {
          syncStatus: result.success ? 'SYNCED' : 'FAILED',
          syncedAt: new Date(),
          errorMessage: result.success ? null : result.error,
        });

        this.logger.log(
          `Prices synced to ${mp}: ${result.data?.success}/${result.data?.total} items`,
        );
      } catch (error) {
        await this.priceSyncRepo.update(syncLog.id, {
          syncStatus: 'FAILED',
          errorMessage: error.message,
        });
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
