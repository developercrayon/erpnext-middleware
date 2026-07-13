import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, ILike } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
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
  // ─── Direct ERPNext API Methods ──────────────────────────────────────────

  async getReferenceData(): Promise<any> {
    const res = await this.erpnextService['connector'].getReferenceData();
    if (!res.success) throw new Error(res.error || 'Failed to fetch');
    return res.data;
  }

  async getItemSchema(): Promise<any> {
    const res = await this.erpnextService['connector'].getItemSchema();
    if (!res.success) throw new Error(res.error || 'Failed to fetch schema');
    return res.data;
  }

  async getFullItem(id: string): Promise<any> {
    const product = await this.findById(id);
    if (!product || !product.erpnextItemCode) throw new Error('Product not found or has no ERPNext item code');
    const res = await this.erpnextService['connector'].getFullItem(product.erpnextItemCode);
    if (!res.success) throw new Error(res.error || 'Failed to fetch full item');
    return res.data;
  }

  async getLinkOptions(doctype: string, query?: string): Promise<any> {
    const res = await this.erpnextService['connector'].getLinkOptions(doctype, query);
    if (!res.success) throw new Error(res.error || 'Failed to fetch options');
    return res.data;
  }

  async updateProduct(id: string, dto: any): Promise<Product> {
    const product = await this.findById(id);
    if (!product) throw new Error('Product not found');

    // Update local DB fields
    Object.assign(product, dto);
    if (dto.erpnextFields?.custom_amazon_product_type !== undefined) {
      product.amazonProductType = dto.erpnextFields.custom_amazon_product_type;
    }
    await this.productRepo.save(product);

    // Map back to ERPNext schema and push
    if (product.erpnextItemCode) {
      const erpPayload: Record<string, any> = {};
      
      if (dto.name !== undefined) erpPayload.item_name = dto.name;
      if (dto.status !== undefined) erpPayload.disabled = dto.status === ProductStatus.INACTIVE ? 1 : 0;
      if (dto.brand !== undefined) erpPayload.brand = dto.brand;
      if (dto.category !== undefined) erpPayload.item_group = dto.category;
      if (dto.hsnCode !== undefined) erpPayload.gst_hsn_code = dto.hsnCode;
      if (dto.weight !== undefined) erpPayload.weight_per_unit = dto.weight;
      if (dto.weightUom !== undefined) erpPayload.weight_uom = dto.weightUom;
      if (dto.costPrice !== undefined) erpPayload.standard_rate = dto.costPrice;
      if (dto.sellingPrice !== undefined) erpPayload.custom_amazon_price = dto.sellingPrice; // Note: ERPNext price sync is complex, updating custom fields
      if (dto.mrp !== undefined) erpPayload.custom_mrp = dto.mrp;
      if (dto.upc !== undefined) erpPayload.custom_upc = dto.upc;
      if (dto.customModelName !== undefined) erpPayload.custom_model_name = dto.customModelName;
      if (dto.description !== undefined) erpPayload.description = dto.description;
      if (dto.customAmazon !== undefined) erpPayload.custom_amazon = dto.customAmazon ? 1 : 0;
      if (dto.customFlipkart !== undefined) erpPayload.custom_flipkart = dto.customFlipkart ? 1 : 0;
      if (dto.customAmazonPrice !== undefined) erpPayload.custom_amazon_price = dto.customAmazonPrice;
      if (dto.customFlipkartPrice !== undefined) erpPayload.custom_flipkart_price = dto.customFlipkartPrice;
      if (dto.amazonProductType !== undefined) erpPayload.custom_amazon_product_type = dto.amazonProductType;
      if (dto.erpnextFields?.custom_amazon_product_type !== undefined) erpPayload.custom_amazon_product_type = dto.erpnextFields.custom_amazon_product_type;

      // Merge dynamic erpnextFields
      if (dto.erpnextFields && typeof dto.erpnextFields === 'object') {
        const cleanFields = { ...dto.erpnextFields };
        
        // Remove system/internal fields that shouldn't be sent back
        const systemFields = ['name', 'creation', 'modified', 'modified_by', 'owner', 'docstatus', 'idx', 'doctype', 'has_variants', 'variant_of', '_user_tags', '_comments', '_assign', '_liked_by'];
        systemFields.forEach(f => delete cleanFields[f]);
        
        // Remove fields that we already explicitly map above to avoid overwriting our changes
        // This also prevents crashing ERPNext when trying to update inherited fields on variants
        const explicitFields = ['item_name', 'item_code', 'disabled', 'brand', 'item_group', 'gst_hsn_code', 'weight_per_unit', 'weight_uom', 'standard_rate', 'custom_amazon_price', 'custom_mrp', 'custom_upc', 'custom_model_name', 'description', 'custom_amazon', 'custom_flipkart', 'custom_flipkart_price', 'custom_amazon_product_type'];
        explicitFields.forEach(f => delete cleanFields[f]);

        Object.assign(erpPayload, cleanFields);
        
        // Also update local attributes jsonb so it reflects immediately
        product.attributes = {
          ...product.attributes,
          ...cleanFields,
        };
        await this.productRepo.save(product);
      }

      if (Object.keys(erpPayload).length > 0) {
        await this.erpnextService.updateItem(product.erpnextItemCode, erpPayload);
      }
    }

    return product;
  }

  async delete(id: string): Promise<void> {
    const product = await this.findById(id);
    if (!product) throw new Error('Product not found');
    await this.productRepo.remove(product);
  }

  async updateStatus(id: string, status: ProductStatus): Promise<Product> {
    const product = await this.findById(id);
    if (!product) throw new Error('Product not found');
    
    product.status = status;
    await this.productRepo.save(product);

    if (product.erpnextItemCode) {
      await this.erpnextService.updateItem(product.erpnextItemCode, {
        disabled: status === ProductStatus.INACTIVE ? 1 : 0
      });
    }

    return product;
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
      { ...QUEUE_DEFAULT_OPTIONS, jobId: uuidv4() },
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
      this.logger.error(`Failed to insert QueueJob record: ${e.message}`, e.stack);
    }

    this.logger.log(`Product sync job queued: ${job.id}`);
    return String(job.id);
  }

  async triggerFetchFromERPNext(sku?: string): Promise<string> {
    const job = await this.productsQueue.add(
      JOB_NAMES.FETCH_PRODUCTS,
      { sku },
      { ...QUEUE_DEFAULT_OPTIONS, jobId: uuidv4() },
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
      this.logger.error(`Failed to insert QueueJob record: ${e.message}`, e.stack);
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
            customSpecificUsesForProduct: p.customSpecificUsesForProduct || null,
            customRecommendedUsesForProduct: p.customRecommendedUsesForProduct || null,
            customRoomType: p.customRoomType || null,
            customSpecialFeature: p.customSpecialFeature || null,
            customCareInstructions: p.customCareInstructions || null,
            attributes: p.attributes || p.rawPayload || null,
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
