import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { ERPNextService } from '../../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../connectors/flipkart/flipkart.connector';
import { Product } from '../../../database/entities/product.entity';
import { ErrorLog } from '../../../database/entities/logs.entity';
import { MarketplaceSource } from '../../../database/entities/order.entity';

@Processor(QUEUE_NAMES.PRODUCTS)
export class ProductsProcessor {
  private readonly logger = new Logger(ProductsProcessor.name);

  constructor(
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
  ) {}

  /**
   * Fetches products from ERPNext and upserts them into the local database
   */
  @Process(JOB_NAMES.FETCH_PRODUCTS)
  async fetchProductsFromERPNext(job: Job): Promise<void> {
    this.logger.log(`Executing background job: Fetch Products from ERPNext`);

    try {
      const result = await this.erpnextService['connector']?.fetchProducts({ pageSize: 500 });
      if (!result?.success) {
        throw new Error('Failed to fetch products from ERPNext');
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

    // This is a placeholder for actual product listing API calls which are complex
    // Usually requires submitting catalog feeds to Amazon/Flipkart
    this.logger.log(`Product sync involves catalog feeds. Currently mock-executed for SKUs: ${skus?.join(', ') || 'ALL'}`);
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
