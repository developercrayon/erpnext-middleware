import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { ERPNextService } from '../../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../connectors/flipkart/flipkart.connector';
import { Inventory } from '../../../database/entities/inventory.entity';
import { MarketplaceSource } from '../../../database/entities/order.entity';
import { ErrorLog } from '../../../database/entities/logs.entity';
import { Product } from '../../../database/entities/product.entity';
import { SyncHistory, SyncResourceType, ItemSyncLog } from '../../../database/entities/operational.entity';

@Processor(QUEUE_NAMES.INVENTORY)
export class InventoryProcessor {
  private readonly logger = new Logger(InventoryProcessor.name);

  constructor(
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(ItemSyncLog)
    private readonly itemSyncLogRepo: Repository<ItemSyncLog>,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(SyncHistory)
    private readonly syncHistoryRepo: Repository<SyncHistory>,
  ) {}

  /**
   * Fetches current inventory from ERPNext and pushes updates to all marketplaces.
   */
  @Process(JOB_NAMES.SYNC_INVENTORY_TO_MARKETPLACE)
  async syncInventoryToMarketplace(job: Job): Promise<void> {
    const { source, skus } = job.data;
    this.logger.log(`Syncing inventory to ${source || 'all'} marketplaces`);

    let targetSkus = skus || [];
    
    // If no specific SKUs provided, fetch all SKUs that are synced to any marketplace
    if (targetSkus.length === 0) {
      const products = await this.productRepo.find({
        where: [
          { customAmazon: true, isParent: false },
          { customFlipkart: true, isParent: false }
        ],
        select: ['sku']
      });
      targetSkus = products.map(p => p.sku);
    }

    if (targetSkus.length === 0) {
      this.logger.warn('No SKUs found to sync inventory for.');
      return;
    }

    // Fetch inventory from ERPNext
    const inventoryMap = await this.erpnextService.getInventoryForSkus(targetSkus);

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

      const syncHistory = this.syncHistoryRepo.create({
        resourceType: SyncResourceType.INVENTORY,
        source: mp,
        status: 'IN_PROGRESS',
        itemsTotal: inventoryItems.length,
        startedAt: new Date(),
      });
      await this.syncHistoryRepo.save(syncHistory);

      try {
        const result = await connector.updateInventory(inventoryItems);

        const successCount = result.data?.success || 0;
        const failureCount = result.data?.failed || (result.success ? 0 : inventoryItems.length);

        syncHistory.status = result.success ? (failureCount > 0 ? 'PARTIAL' : 'COMPLETED') : 'FAILED';
        syncHistory.itemsSynced = successCount;
        syncHistory.itemsFailed = failureCount;
        syncHistory.completedAt = new Date();
        syncHistory.durationMs = syncHistory.completedAt.getTime() - syncHistory.startedAt.getTime();
        syncHistory.error = result.success ? null : result.error;
        await this.syncHistoryRepo.save(syncHistory);

        // Upsert inventory records and detailed sync logs
        if (result.success) {
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
            
            await this.itemSyncLogRepo.save({
              resourceType: SyncResourceType.INVENTORY,
              referenceId: item.sku,
              source: mp,
              syncStatus: 'SYNCED',
              syncedAt: new Date(),
              details: { warehouse: item.warehouse, qtyAfter: item.availableQty }
            });
          }
          
          // Also update Product.availableQty so it's visible in the Product UI
          for (const item of inventoryItems) {
            await this.productRepo.update(
              { sku: item.sku },
              { availableQty: item.availableQty }
            );
          }
        } else {
          // If the batch completely failed, record it
          for (const item of inventoryItems) {
            await this.itemSyncLogRepo.save({
              resourceType: SyncResourceType.INVENTORY,
              referenceId: item.sku,
              source: mp,
              syncStatus: 'FAILED',
              errorMessage: result.error,
              syncedAt: new Date(),
              details: { warehouse: item.warehouse, qtyAfter: item.availableQty }
            });
          }
        }

        this.logger.log(
          `Inventory synced to ${mp}: ${successCount}/${inventoryItems.length} items`,
        );
      } catch (error) {
        // Detailed failure logs
        for (const item of inventoryItems) {
          await this.itemSyncLogRepo.save({
            resourceType: SyncResourceType.INVENTORY,
            referenceId: item.sku,
            source: mp,
            syncStatus: 'FAILED',
            errorMessage: error.message,
            syncedAt: new Date(),
            details: { warehouse: item.warehouse, qtyAfter: item.availableQty }
          });
        }
        syncHistory.status = 'FAILED';
        syncHistory.error = error.message;
        syncHistory.completedAt = new Date();
        syncHistory.durationMs = syncHistory.completedAt.getTime() - syncHistory.startedAt.getTime();
        await this.syncHistoryRepo.save(syncHistory);
        
        throw error;
      }
    }
  }

  /**
   * Fetches current inventory from ERPNext and updates local Database only.
   */
  @Process(JOB_NAMES.FETCH_INVENTORY_FROM_ERPNEXT)
  async fetchInventoryFromERPNext(job: Job): Promise<void> {
    const { skus } = job.data;
    this.logger.log(`Fetching latest inventory from ERPNext for ${skus?.length ? skus.length : 'all'} SKUs`);

    let targetSkus = skus || [];
    
    if (targetSkus.length === 0) {
      const products = await this.productRepo.find({
        where: [
          { customAmazon: true, isParent: false },
          { customFlipkart: true, isParent: false }
        ],
        select: ['sku']
      });
      targetSkus = products.map(p => p.sku);
    }

    if (targetSkus.length === 0) {
      this.logger.warn('No SKUs found to fetch inventory for.');
      return;
    }

    const inventoryMap = await this.erpnextService.getInventoryForSkus(targetSkus);

    if (!Object.keys(inventoryMap).length) {
      this.logger.warn('No inventory data found in ERPNext');
      return;
    }

    // Update Product availableQty
    for (const [sku, qty] of Object.entries(inventoryMap)) {
      await this.productRepo.update({ sku }, { availableQty: qty });
    }

    this.logger.log(`Successfully fetched and updated local inventory for ${Object.keys(inventoryMap).length} items`);
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
