import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldMapping } from '../../database/entities/mapping.entity';
import { Product } from '../../database/entities/product.entity';
import { MarketplaceSource } from '../../database/entities/order.entity';
import { AmazonProductField } from '../../database/entities/amazon-product-field.entity';
import { ErpnextProductField } from '../../database/entities/erpnext-product-field.entity';
import { CreateMappingDto, UpdateMappingDto } from './dto/mapping.dto';

import { ERPNextConnector } from '../connectors/erpnext/erpnext.connector';

@Injectable()
export class MappingService {
  private readonly logger = new Logger(MappingService.name);

  constructor(
    @InjectRepository(FieldMapping)
    private readonly mappingRepo: Repository<FieldMapping>,
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(AmazonProductField)
    private readonly amazonProductFieldRepo: Repository<AmazonProductField>,
    @InjectRepository(ErpnextProductField)
    private readonly erpnextProductFieldRepo: Repository<ErpnextProductField>,
    private readonly erpnextConnector: ERPNextConnector,
  ) {}

  async findAll(marketplace?: MarketplaceSource, productType?: string): Promise<FieldMapping[]> {
    const where: any = {};
    if (marketplace) where.marketplace = marketplace;
    if (productType) where.productType = productType;
    return this.mappingRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async create(dto: CreateMappingDto): Promise<FieldMapping> {
    const mapping = this.mappingRepo.create(dto);
    return this.mappingRepo.save(mapping);
  }

  async createBulk(mappings: CreateMappingDto[]): Promise<FieldMapping[]> {
    const entities = this.mappingRepo.create(mappings);
    return this.mappingRepo.save(entities);
  }

  async update(id: string, dto: UpdateMappingDto): Promise<FieldMapping> {
    await this.mappingRepo.update(id, dto);
    return this.mappingRepo.findOne({ where: { id } });
  }

  async delete(id: string): Promise<void> {
    await this.mappingRepo.delete(id);
  }

  async getAmazonFields(productType?: string): Promise<{ label: string; value: string; isRequired?: boolean }[]> {
    if (!productType) {
      return [];
    }
    const fields = await this.amazonProductFieldRepo.find({
      where: { productTypeName: productType },
      order: { label: 'ASC' },
    });
    
    return fields.map(f => ({
      label: f.label || f.name,
      value: f.name,
      isRequired: f.isRequired
    }));
  }

  async syncErpnextFields(): Promise<{ message: string; count: number }> {
    const result = await this.erpnextConnector.getItemFields();
    if (!result.success || !result.data) {
      throw new Error(`Failed to fetch ERPNext Item fields: ${result.error || 'Unknown error'}`);
    }

    const entitiesToUpsert: any[] = [];
    const standardFields = [
      'sku', 'name', 'description', 'brand', 'category', 'mrp', 'sellingPrice', 'weight', 'hsnCode',
    ];

    // Prepare standard internal fallbacks
    for (const f of standardFields) {
      entitiesToUpsert.push({
        name: f,
        label: this.formatLabel(f),
        fieldtype: 'Data',
        isCustom: false,
      });
    }

    // Prepare ERPNext fields
    for (const f of result.data) {
      if (['Column Break', 'Section Break', 'Tab Break'].includes(f.fieldtype)) continue;

      entitiesToUpsert.push({
        name: f.fieldname,
        label: f.label || this.formatLabel(f.fieldname),
        fieldtype: f.fieldtype,
        isCustom: f.fieldname.startsWith('custom_'),
      });
    }

    if (entitiesToUpsert.length > 0) {
      // Chunk the array if it's too large, but Postgres handles ~1000 items fine
      await this.erpnextProductFieldRepo.upsert(entitiesToUpsert, ['name']);
    }

    return { message: 'ERPNext fields synced successfully', count: entitiesToUpsert.length };
  }

  async getErpnextFields(): Promise<{ label: string; value: string }[]> {
    const fields = await this.erpnextProductFieldRepo.find({
      order: { label: 'ASC' },
    });
    
    return fields.map(f => ({
      label: f.label,
      value: f.name,
    }));
  }

  private formatLabel(key: string): string {
    // Converts snake_case or camelCase to Title Case
    const result = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
    return result.charAt(0).toUpperCase() + result.slice(1).trim();
  }
}
