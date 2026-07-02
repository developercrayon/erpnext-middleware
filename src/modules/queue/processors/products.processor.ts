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
import { MarketplaceSource } from '../../../database/entities/order.entity';
import { NormalizedProduct } from '../../connectors/base/connector.types';

@Processor(QUEUE_NAMES.PRODUCTS)
export class ProductsProcessor {
  private readonly logger = new Logger(ProductsProcessor.name);

  constructor(
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectQueue(QUEUE_NAMES.PRODUCTS) private readonly productsQueue: Queue,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
  ) { }

  /**
   * Fetches products from ERPNext and upserts them into the local database
   */
  @Process(JOB_NAMES.FETCH_PRODUCTS)
  async fetchProductsFromERPNext(job: Job): Promise<void> {
    const skuFilter = job.data?.sku;
    this.logger.log(`Executing background job: Fetch Products from ERPNext${skuFilter ? ' (SKU: ' + skuFilter + ')' : ''}`);

    try {
      const result = await this.erpnextService['connector']?.fetchProducts({ 
        pageSize: 500,
        sku: skuFilter
      });
      if (!result?.success) {
        throw new Error(`Failed to fetch products from ERPNext: ${result?.error || 'Unknown error'}`);
      }

      const products = result.data?.items || [];
      let upserted = 0;

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
              attributes: p.rawPayload,
              lastSyncedAt: new Date(),
            },
            ['sku'],
          );
          upserted++;
        } catch (err) {
          this.logger.error(`Failed to upsert product ${p.sku}: ${err.message}`);
        }
      }

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
