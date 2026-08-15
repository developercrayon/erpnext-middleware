import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { ERPNextService } from '../../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../connectors/flipkart/flipkart.connector';
import { ErrorLog } from '../../../database/entities/logs.entity';
import { SyncHistory, SyncResourceType } from '../../../database/entities/operational.entity';
import { MarketplaceSource } from '../../../database/entities/order.entity';
import { NormalizedProduct } from '../../connectors/base/connector.types';

import { ProductsService } from '../../products/products.service';

@Processor(QUEUE_NAMES.PRODUCTS)
export class ProductsProcessor {
  private readonly logger = new Logger(ProductsProcessor.name);

  constructor(
    private readonly productsService: ProductsService,
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectQueue(QUEUE_NAMES.PRODUCTS) private readonly productsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.INVENTORY) private readonly inventoryQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PRICING) private readonly pricingQueue: Queue,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
    @InjectRepository(SyncHistory)
    private readonly syncHistoryRepo: Repository<SyncHistory>,
  ) { }

  @Process(JOB_NAMES.SYNC_PRODUCTS)
  async syncProducts(job: Job): Promise<void> {
    const { source, skus, skipInventorySync } = job.data;
    this.logger.log(`Executing background job: Sync Products to ${source || 'all marketplaces'}`);

    // Fetch products from ERPNext instead of local DB
    let products: any[] = [];
    
    if (skus && skus.length > 0) {
      // Fetch each SKU
      for (const sku of skus) {
        const result = await this.erpnextService['connector'].getFullItem(sku);
        if (result.success && result.data) {
          products.push(result.data);
        }
      }
    } else {
      // If no SKUs provided, fetch all from ERPNext (be careful with limits)
      // Usually triggered for specific SKUs now.
      const result = await this.erpnextService['connector'].fetchProducts({ pageSize: 1000 });
      if (result.success && result.data?.items) {
        products = result.data.items;
      }
    }

    if (!products.length) {
      this.logger.warn('No products found matching the criteria for sync.');
      return;
    }

    // Sort to process parents first
    products.sort((a, b) => {
      const aIsParent = a.has_variants === 1;
      const bIsParent = b.has_variants === 1;
      if (aIsParent && !bIsParent) return -1;
      if (!aIsParent && bIsParent) return 1;
      return 0;
    });

    const marketplaces = source
      ? [source]
      : [MarketplaceSource.AMAZON, MarketplaceSource.FLIPKART];

    for (const mp of marketplaces) {
      const connector = mp === MarketplaceSource.AMAZON ? this.amazonConnector : this.flipkartConnector;
      
      let successCount = 0;
      let failureCount = 0;

      const syncHistory = this.syncHistoryRepo.create({
        resourceType: SyncResourceType.PRODUCT,
        source: mp,
        status: 'IN_PROGRESS',
        itemsTotal: products.length,
        startedAt: new Date(),
      });
      await this.syncHistoryRepo.save(syncHistory);

      for (const product of products) {
        // Product structure here is the raw ERPNext item data or NormalizedProduct 
        // Need to adapt to NormalizedProduct expected by connectors
        
        const isAmazon = mp === MarketplaceSource.AMAZON;
        const isFlipkart = mp === MarketplaceSource.FLIPKART;
        
        const customAmazon = product.custom_amazon === 1;
        const customFlipkart = product.custom_flipkart === 1;

        if (isAmazon && !customAmazon) continue;
        if (isFlipkart && !customFlipkart) continue;

        try {
          const getPrice = (customPrice: number, standardPrice: number, valRate: number) => {
            if (customPrice && customPrice > 0) return customPrice;
            if (standardPrice && standardPrice > 0) return standardPrice;
            return valRate || 0;
          };

          const sellingPrice = isAmazon
            ? getPrice(product.custom_amazon_price, product.custom_mrp, product.valuation_rate)
            : isFlipkart
              ? getPrice(product.custom_flipkart_price, product.custom_mrp, product.valuation_rate)
              : product.custom_mrp;

          const normalizedProduct: NormalizedProduct = {
            sku: product.item_code,
            amazonAsin: product.custom_amazon_asin,
            amazonProductType: product.custom_amazon_product_type,
            upc: product.barcodes?.length > 0 ? product.barcodes[0].barcode : null,
            name: product.item_name,
            description: product.description,
            category: product.item_group,
            brand: product.brand,
            mrp: product.custom_mrp,
            sellingPrice: sellingPrice,
            weight: product.weight_per_unit,
            isParent: product.has_variants === 1,
            variantOf: product.variant_of,
            erpnextRawPayload: product, 
          };

          const result = await connector.createListing(normalizedProduct, true);

          if (result.success) {
            successCount++;
            this.logger.log(`Successfully synced ${product.item_code} to ${mp}`);
            
            // Write success status back to ERPNext
            const statusField = isAmazon ? 'custom_amazon_sync_status' : 'custom_flipkart_sync_status';
            const dateField = isAmazon ? 'custom_amazon_sync' : 'custom_flipkart_sync';
            
            await this.erpnextService['connector'].updateItem(product.item_code, {
              [statusField]: 'synced',
              [dateField]: new Date().toISOString().replace('T', ' ').substring(0, 19)
            });
            
          } else {
            failureCount++;
            this.logger.error(`Failed to sync ${product.item_code} to ${mp}: ${result.error}`);
            
            // Write failure status back to ERPNext
            const statusField = isAmazon ? 'custom_amazon_sync_status' : 'custom_flipkart_sync_status';
            
            await this.erpnextService['connector'].updateItem(product.item_code, {
              [statusField]: 'failed'
            });

            await this.errorLogRepo.save({
              source: mp,
              context: 'SYNC_ERROR',
              message: `Failed to sync product ${product.item_code}: ${result.error}`,
              payload: normalizedProduct,
            } as any);
          }
        } catch (error: any) {
          failureCount++;
          this.logger.error(`Exception syncing ${product.item_code} to ${mp}: ${error.message}`);
          
          const statusField = isAmazon ? 'custom_amazon_sync_status' : 'custom_flipkart_sync_status';
          await this.erpnextService['connector'].updateItem(product.item_code, {
            [statusField]: 'failed'
          });
        }
      }

      syncHistory.status = failureCount > 0 ? 'PARTIAL_SUCCESS' : 'COMPLETED';
      syncHistory.itemsSynced = successCount;
      syncHistory.itemsFailed = failureCount;
      syncHistory.completedAt = new Date();
      await this.syncHistoryRepo.save(syncHistory);

      this.logger.log(`Finished syncing to ${mp}. Success: ${successCount}, Failed: ${failureCount}`);
    }

    if (!skipInventorySync && skus && skus.length > 0) {
      await this.inventoryQueue.add(JOB_NAMES.SYNC_INVENTORY_TO_MARKETPLACE, { source, skus });
    }
  }
}
