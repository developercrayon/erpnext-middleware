import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, ILike } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Product, ProductStatus } from '../../database/entities/product.entity';
import { ERPNextService } from '../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../connectors/flipkart/flipkart.connector';
import { QUEUE_NAMES, JOB_NAMES, QUEUE_DEFAULT_OPTIONS } from '../queue/queue.constants';
import { MarketplaceSource } from '../../database/entities/order.entity';
import { ProductQueryDto } from './dto/product.dto';

import { QueueJob, QueueJobStatus } from '../../database/entities/operational.entity';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectQueue(QUEUE_NAMES.PRODUCTS)
    private readonly productsQueue: Queue,
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
  ) {}

  // ─── Query Methods ────────────────────────────────────────────────────────

  async findAll(query: ProductQueryDto): Promise<{ data: Product[]; total: number }> {
    const { status, marketplace, sku, category, brand, page = 1, pageSize = 20 } = query;

    const where: any = {};
    if (status) where.status = status;
    if (sku) where.sku = ILike(`%${sku}%`);
    if (category) where.category = ILike(`%${category}%`);
    if (brand) where.brand = ILike(`%${brand}%`);
    if (marketplace === MarketplaceSource.AMAZON) where.isAmazonListed = true;
    if (marketplace === MarketplaceSource.FLIPKART) where.isFlipkartListed = true;

    const options: FindManyOptions<Product> = {
      where,
      order: { updatedAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    const [data, total] = await this.productRepo.findAndCount(options);
    return { data, total };
  }

  async findBySku(sku: string): Promise<Product | null> {
    return this.productRepo.findOne({ where: { sku } });
  }

  async findById(id: string): Promise<Product | null> {
    return this.productRepo.findOne({ where: { id } });
  }

  // ─── Sync Triggers ────────────────────────────────────────────────────────

  /**
   * Triggers a product sync job:
   * 1. Fetches from ERPNext
   * 2. Upserts into local products table
   * 3. Optionally pushes to marketplace(s)
   */
  async triggerSync(source?: MarketplaceSource, skus?: string[]): Promise<string> {
    const job = await this.productsQueue.add(
      JOB_NAMES.SYNC_PRODUCTS,
      { source, skus },
      QUEUE_DEFAULT_OPTIONS,
    );
    
    // Synchronously insert the DB record so it immediately appears in the UI
    // Using insert instead of upsert so we don't accidentally overwrite a COMPLETED status
    // if the job finished instantly before this line executes.
    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.PRODUCTS,
        jobName: JOB_NAMES.SYNC_PRODUCTS,
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: job.opts?.attempts || 3,
      });
    } catch (e) {
      // Ignore unique constraint violation (means listener already saved it as COMPLETED/ACTIVE)
    }

    this.logger.log(`Product sync job queued: ${job.id}`);
    return String(job.id);
  }

  async triggerFetchFromERPNext(sku?: string): Promise<string> {
    const job = await this.productsQueue.add(
      JOB_NAMES.FETCH_PRODUCTS,
      { sku },
      QUEUE_DEFAULT_OPTIONS,
    );

    // Synchronously insert the DB record so it immediately appears in the UI
    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.PRODUCTS,
        jobName: JOB_NAMES.FETCH_PRODUCTS,
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: job.opts?.attempts || 3,
      });
    } catch (e) {
      // Ignore unique constraint violation
    }

    this.logger.log(`Fetch products from ERPNext job queued: ${job.id}`);
    return String(job.id);
  }

  // ─── ERPNext Sync ─────────────────────────────────────────────────────────

  /**
   * Fetches products from ERPNext and upserts into the local DB.
   */
  async syncFromERPNext(): Promise<{ total: number; upserted: number }> {
    const result = await this.erpnextService['connector']?.fetchProducts({ pageSize: 500 });
    if (!result?.success) {
      this.logger.warn('No products fetched from ERPNext');
      return { total: 0, upserted: 0 };
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
            thumbnailUrl: p.thumbnailUrl || (p.images && p.images.length > 0 ? p.images[0] : null),
            images: p.images || [],
            mrp: p.mrp || 0,
            sellingPrice: p.sellingPrice || 0,
            hsnCode: p.hsnCode,
            gstRate: p.gstRate || 18,
            weight: p.weight,
            upc: p.upc || null,
            amazonAsin: p.amazonAsin || null,
            amazonProductType: p.amazonProductType || null,
            status: ProductStatus.ACTIVE,
            lastSyncedAt: new Date(),
          },
          ['sku'],
        );
        upserted++;
      } catch (err) {
        this.logger.error(`Failed to upsert product ${p.sku}: ${err.message}`);
      }
    }

    this.logger.log(`Products synced from ERPNext: ${upserted}/${products.length}`);
    return { total: products.length, upserted };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(): Promise<Record<string, number>> {
    const total = await this.productRepo.count();
    const active = await this.productRepo.count({ where: { status: ProductStatus.ACTIVE } });
    const inactive = await this.productRepo.count({ where: { status: ProductStatus.INACTIVE } });
    const amazonListed = await this.productRepo.count({ where: { isAmazonListed: true } });
    const flipkartListed = await this.productRepo.count({ where: { isFlipkartListed: true } });

    return { total, active, inactive, amazonListed, flipkartListed };
  }
}
