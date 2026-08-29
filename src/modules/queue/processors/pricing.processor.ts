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
import { MarketplaceSource, Order } from '../../../database/entities/order.entity';
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
    require('fs').appendFileSync('C:\\Users\\jalpa\\OneDrive\\Documents\\Git repo\\erpnext-middleware\\debug.log', JSON.stringify({time: new Date(), data: job.data}) + '\n');
    const { source, skus } = job.data;
    this.logger.log(`Syncing prices to ${source || 'all'} marketplaces`);

    const skusToSync = skus || [];
    if (!skusToSync.length) {
      this.logger.warn('No SKUs provided for price sync');
      return;
    }

    // Skip fetching from ERPNext as per user request to directly push local price to Amazon/Flipkart
    // const priceMap = await this.erpnextService.getPricesForSkus(skusToSync);
    const priceMap: Record<string, number> = {};

    // Fetch products from ERPNext directly
    const localProductMap = new Map<string, any>();
    for (const sku of skusToSync) {
      const result = await this.erpnextService['connector'].getFullItem(sku);
      if (result.success && result.data) {
        localProductMap.set(sku, result.data);
      }
    }

    const priceItems: any[] = [];
    const missingSkus: string[] = [];

    const marketplaces = source
      ? [source]
      : [MarketplaceSource.AMAZON];

    for (const sku of skusToSync) {
      let finalPrice = 0;

      const localProd = localProductMap.get(sku);
      if (localProd) {
        // Use marketplace specific custom price if available, else generic selling price
        if (source === MarketplaceSource.AMAZON && localProd.custom_amazon_price) {
          finalPrice = parseFloat(localProd.custom_amazon_price.toString());
        } else if (source === MarketplaceSource.FLIPKART && localProd.custom_flipkart_price) {
          finalPrice = parseFloat(localProd.custom_flipkart_price.toString());
        } else if (localProd.custom_mrp) {
          finalPrice = parseFloat(localProd.custom_mrp.toString());
        }
      }

      if (finalPrice && finalPrice > 0) {
        const productType = localProd?.custom_amazon_product_type || 'PRODUCT';
          
        priceItems.push({
          sku,
          sellingPrice: finalPrice,
          mrp: localProd?.custom_mrp || finalPrice,
          currency: 'INR',
          productType
        });
      } else {
        missingSkus.push(sku);
      }
    }

    if (missingSkus.length > 0) {
      this.logger.warn(`No price data found in ERPNext or local DB for SKUs: ${missingSkus.join(', ')}`);
      // Log failed sync for these items so user can see it in UI
      for (const mp of marketplaces) {
        for (const sku of missingSkus) {
          await this.itemSyncLogRepo.save({
            resourceType: SyncResourceType.PRICE,
            referenceId: sku,
            source: mp,
            syncStatus: 'FAILED',
            errorMessage: 'Price missing in ERPNext and local Database.',
            details: {}
          });
        }
      }
    }

    if (priceItems.length === 0) {
      require('fs').appendFileSync('C:\\Users\\jalpa\\OneDrive\\Documents\\Git repo\\erpnext-middleware\\debug.log', JSON.stringify({time: new Date(), message: "early return", missingSkus}) + '\n');
      return;
    }
    require('fs').appendFileSync('C:\\Users\\jalpa\\OneDrive\\Documents\\Git repo\\erpnext-middleware\\debug.log', JSON.stringify({time: new Date(), priceItems}) + '\n');

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

        const errorsMap = new Map(
          (result.data?.errors || []).map((e: any) => [e.sku, e.error])
        );

        for (const item of priceItems) {
          const errorMsg = errorsMap.get(item.sku);
          const isSuccess = result.success && !errorMsg;

          await this.itemSyncLogRepo.update(
            { resourceType: SyncResourceType.PRICE, referenceId: item.sku, source: mp, syncStatus: 'IN_PROGRESS' },
            {
              syncStatus: isSuccess ? 'SYNCED' : 'FAILED',
              syncedAt: new Date(),
              errorMessage: isSuccess ? null : (errorMsg || result.error),
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
