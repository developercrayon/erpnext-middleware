import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_NAMES, JOB_NAMES, QUEUE_DEFAULT_OPTIONS } from '../queue.constants';
import { ERPNextService } from '../../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../connectors/flipkart/flipkart.connector';
import { Product } from '../../../database/entities/product.entity';
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
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
    @InjectRepository(SyncHistory)
    private readonly syncHistoryRepo: Repository<SyncHistory>,
  ) { }

  /**
   * Fetches products from ERPNext and upserts them into the local database
   */
  @Process(JOB_NAMES.FETCH_PRODUCTS)
  async fetchProductsFromERPNext(job: Job): Promise<void> {
    const skuFilter = job.data?.sku;
    this.logger.log(`Executing background job: Fetch Products from ERPNext${skuFilter ? ' (SKU: ' + skuFilter + ')' : ''}`);

    try {
      const result = await this.erpnextService.fetchProducts({ 
        pageSize: 500,
        sku: skuFilter
      });
      if (!result?.success) {
        throw new Error(`Failed to fetch products from ERPNext: ${result?.error || 'Unknown error'}`);
      }

      const products = result.data?.items || [];
      
      const syncHistory = this.syncHistoryRepo.create({
        resourceType: SyncResourceType.PRODUCT,
        source: 'ERPNEXT',
        status: 'IN_PROGRESS',
        itemsTotal: products.length,
        startedAt: new Date(),
      });
      await this.syncHistoryRepo.save(syncHistory);

      let upserted = 0;
      let failed = 0;

      for (const p of products) {
        try {
          await this.productRepo.upsert(
            {
              sku: p.sku,
              erpnextItemCode: p.sku,
              name: p.name,
              description: p.description,
              category: p.category,
              brand: p.brand,
              mrp: p.mrp || 0,
              sellingPrice: p.sellingPrice || 0,
              hsnCode: p.hsnCode,
              gstRate: p.gstRate || 18,
              weight: p.weight,
              costPrice: p.valuationRate || 0,
              customAmazonPrice: p.customAmazonPrice,
              customFlipkartPrice: p.customFlipkartPrice,
              customAmazon: p.customAmazon,
              customFlipkart: p.customFlipkart,
              amazonProductType: p.amazonProductType || null,
              upc: p.upc || null,
              thumbnailUrl: p.thumbnailUrl || (p.images && p.images.length > 0 ? p.images[0] : null),
              images: p.images,
              isParent: p.isParent || false,
              variantOf: p.variantOf || null,
              variationTheme: p.variationTheme || null,
              variantAttributes: p.variantAttributes || null,
              customItemTypeName: p.customItemTypeName || null,
              customModelName: p.customModelName || null,
              customStyle: p.customStyle || null,
              customNumberOfItems: p.customNumberOfItems || null,
              customColor: p.customColor || null,
              customNumberOfPieces: p.customNumberOfPieces || null,
              customModelNumber: p.customModelNumber || null,
              customManufacturerContactInfo: p.customManufacturerContactInfo || null,
              customRequiredAssembly: p.customRequiredAssembly !== undefined ? p.customRequiredAssembly : null,
              customDepth: p.customDepth !== undefined ? p.customDepth : null,
              customWidth: p.customWidth !== undefined ? p.customWidth : null,
              customHeight: p.customHeight !== undefined ? p.customHeight : null,
              customNumberOfPacks: p.customNumberOfPacks !== undefined ? p.customNumberOfPacks : null,
              customExternalProductInformation: p.customExternalProductInformation || null,
              customShelfThickness: p.customShelfThickness !== undefined ? p.customShelfThickness : null,
              customAssemblyInstructions: p.customAssemblyInstructions || null,
              customUnit: p.customUnit || null,
              customItemShape: p.customItemShape || null,
              customShelfType: p.customShelfType || null,
              customNumberOfShelves: p.customNumberOfShelves || null,
              customMountingType: p.customMountingType || null,
              customFinishType: p.customFinishType || null,
              customSelectMaterial: p.customSelectMaterial || null,
              customIncludedComponents: p.customIncludedComponents || null,
              customAmazonBulletPoint: p.customAmazonBulletPoint || null,
              customPackerContactInformation: p.customPackerContactInformation || null,
              attributes: p.rawPayload,
              lastSyncedAt: new Date(),
            },
            ['sku'],
          );
          upserted++;
        } catch (err) {
          failed++;
          this.logger.error(`Failed to upsert product ${p.sku}: ${err.message}`);
        }
      }
      
      syncHistory.status = failed > 0 ? (upserted === 0 ? 'FAILED' : 'PARTIAL') : 'COMPLETED';
      syncHistory.itemsSynced = upserted;
      syncHistory.itemsFailed = failed;
      syncHistory.completedAt = new Date();
      syncHistory.durationMs = syncHistory.completedAt.getTime() - syncHistory.startedAt.getTime();
      await this.syncHistoryRepo.save(syncHistory);

      this.logger.log(`Products fetched from ERPNext: ${upserted}/${products.length}`);
      
      // Auto-sync single product if triggered by Webhook
      if (skuFilter && products.length > 0) {
        const p = products[0];
        if (p.customAmazon) {
          await this.productsQueue.add(JOB_NAMES.SYNC_PRODUCTS, { source: MarketplaceSource.AMAZON, skus: [skuFilter] }, QUEUE_DEFAULT_OPTIONS);
          this.logger.log(`Auto-queued Amazon sync for ${skuFilter}`);
        }
        if (p.customFlipkart) {
          await this.productsQueue.add(JOB_NAMES.SYNC_PRODUCTS, { source: MarketplaceSource.FLIPKART, skus: [skuFilter] }, QUEUE_DEFAULT_OPTIONS);
          this.logger.log(`Auto-queued Flipkart sync for ${skuFilter}`);
        }
      }

    } catch (error) {
      throw error;
    }
  }

  @Process(JOB_NAMES.FETCH_AMAZON_PRODUCTS)
  async fetchAmazonProducts(job: Job): Promise<void> {
    this.logger.log(`Executing background job: Fetch Products from Amazon`);
    try {
      await this.productsService.fetchFromAmazonAndStore();
    } catch (error) {
      this.logger.error(`Error in fetchAmazonProducts: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Syncs specific products to a given marketplace (or all)
   */
  @Process(JOB_NAMES.SYNC_PRODUCTS)
  async syncProducts(job: Job): Promise<void> {
    const { source, skus } = job.data;
    this.logger.log(`Executing background job: Sync Products to ${source || 'all marketplaces'}`);

    const query = this.productRepo.createQueryBuilder('product');
    if (skus && skus.length > 0) {
      query.where('product.sku IN (:...skus)', { skus });
    }
    const products = await query.getMany();

    if (!products.length) {
      this.logger.warn('No products found matching the criteria for sync.');
      return;
    }

    // Sort products: Parents (isParent = true, variantOf = null) first, then children
    products.sort((a, b) => {
      if (a.isParent && !b.isParent) return -1;
      if (!a.isParent && b.isParent) return 1;
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
        if (mp === MarketplaceSource.AMAZON && !product.customAmazon) continue;
        if (mp === MarketplaceSource.FLIPKART && !product.customFlipkart) continue;

        try {
          const getPrice = (customPrice: number, standardPrice: number, valRate: number) => {
            if (customPrice && customPrice > 0) return customPrice;
            if (standardPrice && standardPrice > 0) return standardPrice;
            return valRate || 0;
          };

          const sellingPrice = mp === MarketplaceSource.AMAZON 
            ? getPrice(product.customAmazonPrice, product.sellingPrice, product.costPrice)
            : mp === MarketplaceSource.FLIPKART 
              ? getPrice(product.customFlipkartPrice, product.sellingPrice, product.costPrice)
              : getPrice(0, product.sellingPrice, product.costPrice);

          const normalizedProduct: NormalizedProduct = {
            sku: product.sku,
            amazonAsin: product.amazonAsin,
            amazonProductType: product.amazonProductType,
            upc: product.upc,
            thumbnailUrl: product.thumbnailUrl || (product.images && product.images.length > 0 ? product.images[0] : null),
            flipkartSku: product.flipkartSku,
            name: product.name,
            description: product.description,
            category: product.category,
            brand: product.brand,
            mrp: product.mrp,
            sellingPrice: sellingPrice,
            isParent: product.isParent,
            variantOf: product.variantOf,
            variationTheme: product.variationTheme,
            variantAttributes: product.variantAttributes,
            attributes: product.attributes,
            images: product.images,
            rawPayload: product,
          };

          if (product.isParent) {
             const childProducts = products.filter(p => p.variantOf === product.sku);
             normalizedProduct.children = childProducts.map(cp => ({
               sku: cp.sku,
               amazonAsin: cp.amazonAsin,
               amazonProductType: cp.amazonProductType,
               upc: cp.upc,
               name: cp.name,
               mrp: cp.mrp,
               sellingPrice: cp.sellingPrice,
               isParent: cp.isParent,
               variantOf: cp.variantOf,
               variationTheme: cp.variationTheme,
               variantAttributes: cp.variantAttributes,
             }));
          }

          const result = await connector.createListing(normalizedProduct, true); // true = isDraft

          if (result.success) {
            successCount++;
            if (mp === MarketplaceSource.AMAZON) {
              const updateData: any = { isAmazonListed: true, lastSyncedAt: new Date() };
              if (result.meta && result.meta.asin) {
                updateData.amazonAsin = result.meta.asin;
              }
              await this.productRepo.update(product.id, updateData);
            } else if (mp === MarketplaceSource.FLIPKART) {
              await this.productRepo.update(product.id, { isFlipkartListed: true, lastSyncedAt: new Date() });
            }
          } else {
            failureCount++;
            const errorMsg = result.error || 'Unknown error from marketplace connector';
            this.logger.error(`Failed to push product ${product.sku} to ${mp}: ${errorMsg}`);
            await this.errorLogRepo.save({
              source: QUEUE_NAMES.PRODUCTS,
              context: `sync-to-${mp.toLowerCase()}`,
              message: `Failed to sync SKU "${product.sku}" to ${mp}: ${errorMsg}`,
              stackTrace: JSON.stringify(result),
              payload: { sku: product.sku, marketplace: mp },
            });
          }
        } catch (error) {
          failureCount++;
          this.logger.error(`Error syncing product ${product.sku} to ${mp}: ${error.message}`);
        }
      }

      this.logger.log(`Finished syncing products to ${mp}: ${successCount} succeeded, ${failureCount} failed.`);
      
      syncHistory.status = failureCount > 0 ? (successCount === 0 ? 'FAILED' : 'PARTIAL') : 'COMPLETED';
      syncHistory.itemsSynced = successCount;
      syncHistory.itemsFailed = failureCount;
      syncHistory.completedAt = new Date();
      syncHistory.durationMs = syncHistory.completedAt.getTime() - syncHistory.startedAt.getTime();
      await this.syncHistoryRepo.save(syncHistory);

      // Auto-Sync Chain: If products were successfully pushed, queue an inventory sync for them immediately
      if (successCount > 0) {
        const successSkus = products.map(p => p.sku);
        await this.inventoryQueue.add(JOB_NAMES.SYNC_INVENTORY_TO_MARKETPLACE, {
          source: mp,
          skus: successSkus
        });
        this.logger.log(`Auto-queued inventory sync to ${mp} for ${successCount} products`);
      }

      if (failureCount > 0) {
        throw new Error(`Sync to ${mp} finished with ${failureCount} failures. See Error Logs for details.`);
      }
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job): void {
    this.logger.debug(`Products job ${job.id} (${job.name}) completed`);
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(`Products job ${job.id} failed: ${error.message}`);
    await this.errorLogRepo.save({
      source: QUEUE_NAMES.PRODUCTS,
      context: job.name,
      message: error.message,
      stackTrace: error.stack,
      payload: job.data,
    });
  }
}
