import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ERPNextService } from '../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../connectors/flipkart/flipkart.connector';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { MarketplaceSource } from '../../database/entities/order.entity';
import { ProductQueryDto } from './dto/product.dto';
import { mapFrontendToERPNext } from './mapper';

// Re-defining ProductStatus since product entity is removed
export enum ProductStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectQueue(QUEUE_NAMES.PRODUCTS)
    private readonly productsQueue: Queue,
    private readonly config: ConfigService,
  ) { }

  // ─── Query Methods (Proxied to ERPNext) ──────────────────────────────────

  async findAll(query: ProductQueryDto) {
    // Proxy the find request to ERPNext
    const limit = query.pageSize || 50;
    const offset = query.page ? (query.page - 1) * limit : 0;
    const searchParam = (query as any).search || undefined;
    const result = await this.erpnextService['connector'].fetchProducts({
      pageSize: limit,
      limit_start: offset,
      search: searchParam,
    });
    
    if (!result.success || !result.data) {
      throw new Error(result.error || 'Failed to fetch products from ERPNext');
    }

    return {
      data: result.data.items,
      total: (result.data as any).total || (result.data as any).totalCount || result.data.items.length,
      page: Math.floor(offset / limit) + 1,
      limit,
    };
  }

  async findById(sku: string) {
    return this.erpnextService['connector'].getFullItem(sku);
  }

  async getFullItem(sku: string) {
    return this.erpnextService['connector'].getFullItem(sku);
  }

  // ─── Actions (Proxied to ERPNext) ────────────────────────────────────────

  async createProduct(data: any) {
    // We create directly in ERPNext
    const mappedData = mapFrontendToERPNext(data);
    const result = await this.erpnextService['connector'].createItem(mappedData);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.data;
  }

  async updateProduct(sku: string, data: any) {
    // We update directly in ERPNext
    const result = await this.erpnextService['connector'].updateItem(sku, data);
    return result;
  }

  async remove(sku: string) {
    // Delete from ERPNext directly
    // This assumes we add deleteItem to the connector
    const result = await this.erpnextService['connector'].updateItem(sku, { disabled: 1 });
    return result;
  }

  async updateStatus(sku: string, disabled: number) {
    const result = await this.erpnextService['connector'].updateItem(sku, { disabled });
    return result;
  }

  // ─── Sync Methods ────────────────────────────────────────────────────────

  async triggerSync(
    marketplace?: MarketplaceSource,
    skus?: string[],
    isImmediateAmazonSync = false
  ): Promise<string> {
    const jobId = Date.now().toString();
    await this.productsQueue.add(JOB_NAMES.SYNC_PRODUCTS, {
      source: marketplace,
      skus,
      isImmediateAmazonSync
    });
    return jobId;
  }

  // ─── Reference Data (Proxied to ERPNext) ─────────────────────────────────

  async getReferenceData() {
    return this.erpnextService['connector'].getReferenceData();
  }

  async getItemSchema() {
    return this.erpnextService['connector'].getItemSchema();
  }

  async getLinkOptions(doctype: string, query?: string) {
    return this.erpnextService['connector'].getLinkOptions(doctype, query);
  }

  async getStats() {
    // Fetch stats directly from ERPNext or dummy for now
    return {
      total: 0,
      active: 0,
      inactive: 0,
      amazonListed: 0,
      flipkartListed: 0,
    };
  }
}
