import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { ERPNextService } from '../../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../connectors/flipkart/flipkart.connector';
import { Inventory, InventorySync } from '../../../database/entities/inventory.entity';
import { MarketplaceSource } from '../../../database/entities/order.entity';
import { ErrorLog } from '../../../database/entities/logs.entity';

@Processor(QUEUE_NAMES.INVENTORY)
export class InventoryProcessor {
  private readonly logger = new Logger(InventoryProcessor.name);

  constructor(
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(InventorySync)
    private readonly inventorySyncRepo: Repository<InventorySync>,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
  ) {}

  /**
   * Fetches current inventory from ERPNext and pushes updates to all marketplaces.
   */
  @Process(JOB_NAMES.SYNC_INVENTORY_TO_MARKETPLACE)
  async syncInventoryToMarketplace(job: Job): Promise<void> {
    const { source, skus } = job.data;
    this.logger.log(`Syncing inventory to ${source || 'all'} marketplaces`);

    // Fetch inventory from ERPNext
    const inventoryMap = await this.erpnextService.getInventoryForSkus(skus || []);

    if (!Object.keys(inventoryMap).length) {
      this.logger.warn('No inventory data found in ERPNext');
      return;
    }

    const inventoryItems = Object.entries(inventoryMap).map(([sku, qty]) => ({
      sku,
      warehouse: 'default',
      availableQty: qty,
    }));

    // Update marketplaces
    const marketplaces = source
      ? [source]
      : [MarketplaceSource.AMAZON, MarketplaceSource.FLIPKART];

    for (const mp of marketplaces) {
      const connector =
        mp === MarketplaceSource.AMAZON ? this.amazonConnector : this.flipkartConnector;

      const syncLog = await this.inventorySyncRepo.save({
        sku: 'batch',
        source: mp,
        syncStatus: 'IN_PROGRESS',
      });

      try {
        const result = await connector.updateInventory(inventoryItems);

        await this.inventorySyncRepo.update(syncLog.id, {
          syncStatus: result.success ? 'SYNCED' : 'FAILED',
          syncedAt: new Date(),
          errorMessage: result.success ? null : result.error,
        });

        // Upsert inventory records
        for (const item of inventoryItems) {
          await this.inventoryRepo.upsert(
            {
              sku: item.sku,
              warehouse: item.warehouse,
              source: mp,
              availableQty: item.availableQty,
              marketplaceQty: item.availableQty,
              lastSyncedAt: new Date(),
            },
            ['sku', 'warehouse', 'source'],
          );
        }

        this.logger.log(
          `Inventory synced to ${mp}: ${result.data?.success}/${result.data?.total} items`,
        );
      } catch (error) {
        await this.inventorySyncRepo.update(syncLog.id, {
          syncStatus: 'FAILED',
          errorMessage: error.message,
        });
        throw error;
      }
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job): void {
    this.logger.debug(`Inventory job ${job.id} completed`);
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(`Inventory job ${job.id} failed: ${error.message}`);
    await this.errorLogRepo.save({
      source: QUEUE_NAMES.INVENTORY,
      context: job.name,
      message: error.message,
      stackTrace: error.stack,
      payload: job.data,
    });
  }
}
