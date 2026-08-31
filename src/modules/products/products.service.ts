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
    // Fetch the Item schema so the mapper can resolve child table doctypes
    let schema: Array<{ fieldname: string; fieldtype: string; options?: string }> = [];
    try {
      const schemaResult = await this.erpnextService['connector'].getItemSchema();
      if (schemaResult?.success && Array.isArray(schemaResult.data)) {
        schema = schemaResult.data;
      }
    } catch (e) {
      this.logger.warn('Could not fetch item schema for mapper — child doctype injection skipped');
    }

    const mappedData = mapFrontendToERPNext(data, schema);
    const result = await this.erpnextService['connector'].createItem(mappedData);
    if (!result.success) {
      throw new Error(result.error);
    }

    const itemCode = result.data.name;

    // Upload attachment files to ERPNext via upload_file API (with doctype + docname context)
    if (data._uploaded_images && data._uploaded_images.length > 0) {
      for (const url of data._uploaded_images) {
        try {
          await this.erpnextService['connector'].attachFileToItem(itemCode, url);
        } catch (e) {
          this.logger.warn(`Failed to attach image URL to item ${itemCode}: ${url}`);
        }
      }
    }

    return result.data;
  }


  async uploadImage(file: any) {
    const result = await this.erpnextService['connector'].uploadFile(file);
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  async uploadImageToItem(file: any, itemCode: string) {
    const result = await this.erpnextService['connector'].uploadFileToItem(file, itemCode);
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  async updateProduct(sku: string, data: any) {
    // We update directly in ERPNext
    const result = await this.erpnextService['connector'].updateItem(sku, data);
    return result;
  }

  async remove(sku: string) {
    // Hard delete from ERPNext
    const result = await this.erpnextService['connector'].deleteItem(sku);
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  async updateStatus(sku: string, disabled: number) {
    const result = await this.erpnextService['connector'].updateItem(sku, { disabled });
    return result;
  }

  async disableAmazonListing(sku: string) {
    this.logger.log(`Setting Amazon qty=0 and price=0 for ${sku}`);
    
    // Set Quantity = 0
    try {
      const invResult = await this.amazonConnector.updateInventory([{
        sku,
        warehouse: 'DEFAULT',
        availableQty: 0
      }]);
      if (!invResult.success) {
        this.logger.error(`Failed to zero-out inventory for ${sku}: ${invResult.error}`);
      } else {
        this.logger.log(`Successfully set Amazon qty=0 for ${sku}`);
      }
    } catch (e) {
      this.logger.error(`Error setting qty=0 for ${sku}: ${e.message}`);
    }

    // Set Price = 0
    try {
      const priceResult = await this.amazonConnector.updatePrice([{
        sku,
        sellingPrice: 0,
        currency: 'INR',
        productType: 'PRODUCT' // default type
      }]);
      if (!priceResult.success) {
        this.logger.error(`Failed to zero-out price for ${sku}: ${priceResult.error}`);
      } else {
        this.logger.log(`Successfully set Amazon price=0 for ${sku}`);
      }
    } catch (e) {
      this.logger.error(`Error setting price=0 for ${sku}: ${e.message}`);
    }
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

  async getDoctypeSchema(doctype: string) {
    return this.erpnextService['connector'].getDoctypeSchema(doctype);
  }

  async getLinkOptions(doctype: string, query?: string) {
    return this.erpnextService['connector'].getLinkOptions(doctype, query);
  }

  async resolveItemDisplayValues(itemData: any) {
    const schemaResult = await this.getItemSchema();
    const schema = schemaResult.success ? schemaResult.data : schemaResult;
    const resolvedMap: Record<string, string> = {};
    
    const fetchRequests: { targetDoctype: string, hash: string, fieldName: string }[] = [];

    for (const field of schema) {
      const value = itemData[field.fieldname];
      if (!value) continue;

      if (field.fieldtype === 'Link') {
        fetchRequests.push({ targetDoctype: field.options, hash: value, fieldName: field.fieldname });
      } else if (field.fieldtype === 'Table MultiSelect' || field.fieldtype === 'Table') {
        const childSchemaResult = await this.getDoctypeSchema(field.options);
        const childSchema = childSchemaResult.success ? childSchemaResult.data : childSchemaResult;
        
        if (Array.isArray(childSchema)) {
          const linkField = childSchema.find((f: any) => f.fieldtype === 'Link');
          if (linkField && Array.isArray(value)) {
            for (const row of value) {
              // Row might be a string (hash) or an object
              let hash = '';
              if (typeof row === 'string') {
                hash = row;
              } else if (typeof row === 'object' && row !== null) {
                hash = row[linkField.fieldname] || row.name;
              }
              if (hash) {
                fetchRequests.push({ targetDoctype: linkField.options, hash, fieldName: field.fieldname });
              }
            }
          }
        }
      }
    }

    const grouped: Record<string, string[]> = {};
    for (const req of fetchRequests) {
      if (!grouped[req.targetDoctype]) grouped[req.targetDoctype] = [];
      grouped[req.targetDoctype].push(req.hash);
    }

    const titlesMap: Record<string, string> = {}; // "doctype_hash" -> title
    for (const [doctype, hashes] of Object.entries(grouped)) {
      const uniqueHashes = [...new Set(hashes)];
      const result = await this.erpnextService['connector'].getDocuments(doctype, uniqueHashes);
      const docs = result.success ? result.data : [];
      for (const doc of docs) {
        const title = doc.title || doc.item_name || doc.tag_name || doc.name;
        titlesMap[`${doctype}_${doc.name}`] = title;
      }
    }

    for (const field of schema) {
      const value = itemData[field.fieldname];
      if (!value) continue;

      if (field.fieldtype === 'Link') {
        const title = titlesMap[`${field.options}_${value}`];
        if (title) resolvedMap[field.fieldname] = title;
      } else if (field.fieldtype === 'Table MultiSelect' || field.fieldtype === 'Table') {
        const childSchemaResult = await this.getDoctypeSchema(field.options);
        const childSchema = childSchemaResult.success ? childSchemaResult.data : childSchemaResult;
        
        if (Array.isArray(childSchema)) {
          const linkField = childSchema.find((f: any) => f.fieldtype === 'Link');
          if (linkField && Array.isArray(value)) {
            const titles: string[] = [];
            for (const row of value) {
              let hash = '';
              if (typeof row === 'string') hash = row;
              else if (typeof row === 'object' && row !== null) hash = row[linkField.fieldname] || row.name;
              
              if (hash) {
                const title = titlesMap[`${linkField.options}_${hash}`];
                if (title) titles.push(title);
              }
            }
            if (titles.length > 0) {
              resolvedMap[field.fieldname] = titles.join(', ');
            }
          }
        }
      }
    }

    return { success: true, data: resolvedMap };
  }

  async createMultipleVariants(
    item: string,
    args: Record<string, string[]>,
    useTemplateImage = 0,
  ): Promise<any> {
    const connector = this.erpnextService['connector'] as any;
    // ERPNext expects:
    //   item            — template item code
    //   args            — JSON string mapping attribute name → array of values
    //   use_template_image — 0 | 1
    const result = await connector.enqueueMultipleVariantCreation({
      item,
      args: JSON.stringify(args),
      use_template_image: useTemplateImage,
    });
    return result;
  }

  async getItemAttachments(sku: string) {
    const result = await this.erpnextService['connector'].fetchItemAttachments(sku);
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  async deleteAttachment(fileName: string) {
    const result = await this.erpnextService['connector'].deleteAttachment(fileName);
    if (!result.success) throw new Error(result.error);
    return result.data;
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
