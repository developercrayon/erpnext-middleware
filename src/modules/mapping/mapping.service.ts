import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Not, In } from 'typeorm';
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
  ) { }

  async findAll(marketplace?: MarketplaceSource, productType?: string): Promise<FieldMapping[]> {
    const where: any = {};
    if (marketplace) where.marketplace = marketplace;
    if (productType) where.productType = productType;
    return this.mappingRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async create(dto: CreateMappingDto): Promise<FieldMapping> {
    const existing = await this.mappingRepo.findOne({
      where: {
        marketplace: dto.marketplace,
        productType: dto.productType,
        marketplaceField: dto.marketplaceField,
      },
    });

    if (existing) {
      await this.mappingRepo.update(existing.id, dto);
      return this.mappingRepo.findOne({ where: { id: existing.id } }) as Promise<FieldMapping>;
    }

    const mapping = this.mappingRepo.create(dto);
    return this.mappingRepo.save(mapping);
  }

  async createBulk(mappings: CreateMappingDto[], marketplaceFilter?: string, productTypeFilter?: string): Promise<FieldMapping[]> {
    const marketplace = marketplaceFilter || (mappings.length > 0 ? mappings[0].marketplace : null);
    const productType = productTypeFilter || (mappings.length > 0 ? mappings[0].productType : null);

    if (!marketplace || !productType) {
      return [];
    }

    const existingMappings = await this.mappingRepo.find({
      where: { marketplace: marketplace as MarketplaceSource, productType },
    });

    const existingMap = new Map(
      existingMappings.map(m => [`${m.marketplace}_${m.productType}_${m.marketplaceField}`, m])
    );

    const incomingKeys = new Set(mappings.map(m => `${m.marketplace}_${m.productType}_${m.marketplaceField}`));

    const toUpdate: FieldMapping[] = [];
    const toCreate: FieldMapping[] = [];
    const toDeleteIds: string[] = [];

    for (const dto of mappings) {
      const key = `${dto.marketplace}_${dto.productType}_${dto.marketplaceField}`;
      const existing = existingMap.get(key);

      if (existing) {
        Object.assign(existing, dto);
        toUpdate.push(existing);
      } else {
        toCreate.push(this.mappingRepo.create(dto));
      }
    }

    for (const existing of existingMappings) {
      const key = `${existing.marketplace}_${existing.productType}_${existing.marketplaceField}`;
      if (!incomingKeys.has(key)) {
        toDeleteIds.push(existing.id);
      }
    }

    if (toDeleteIds.length > 0) {
      await this.mappingRepo.delete(toDeleteIds);
    }

    const savedEntities: FieldMapping[] = [];
    if (toUpdate.length > 0) {
      savedEntities.push(...await this.mappingRepo.save(toUpdate));
    }
    if (toCreate.length > 0) {
      savedEntities.push(...await this.mappingRepo.save(toCreate));
    }

    return savedEntities;
  }

  async update(id: string, dto: UpdateMappingDto): Promise<FieldMapping> {
    await this.mappingRepo.update(id, dto);
    return this.mappingRepo.findOne({ where: { id } });
  }

  async delete(id: string): Promise<void> {
    await this.mappingRepo.delete(id);
  }

  async getUniqueAmazonFields(): Promise<{ label: string; value: string }[]> {
    const fields = await this.amazonProductFieldRepo
      .createQueryBuilder('field')
      .select(['field.name', 'field.label'])
      .distinct(true)
      .orderBy('field.label', 'ASC')
      .getRawMany();

    return fields.map(f => ({
      label: f.field_label || f.field_name,
      value: f.field_name,
    }));
  }

  async getAmazonFields(productType?: string): Promise<{ label: string; value: string; isRequired?: boolean; fieldType?: string; schema?: any }[]> {
    if (!productType) {
      return [];
    }
    const fields = await this.amazonProductFieldRepo.find({
      where: { productTypeName: productType },
      order: { label: 'ASC' },
    });

    return fields.map(f => {
      let fType = f.schema?.type;
      if (Array.isArray(fType)) fType = fType[0];
      return {
        label: f.label || f.name,
        value: f.name,
        isRequired: f.isRequired,
        fieldType: fType || undefined,
        schema: f.schema || null,
      };
    });
  }

  async syncErpnextFields(): Promise<{ message: string; count: number }> {
    const result = await this.erpnextConnector.getItemFields();
    if (!result.success || !result.data) {
      throw new Error(`Failed to fetch ERPNext Item fields: ${result.error || 'Unknown error'}`);
    }

    const entitiesToUpsert: any[] = [];


    // Prepare ERPNext fields
    for (const f of result.data) {
      if (!f.fieldname || ['Column Break', 'Section Break', 'Tab Break', 'HTML', 'Heading', 'Fold'].includes(f.fieldtype)) continue;

      entitiesToUpsert.push({
        name: f.fieldname,
        label: f.label || this.formatLabel(f.fieldname),
        fieldtype: f.fieldtype,
        options: f.options ? String(f.options) : null,
        fetchFrom: f.fetch_from || null,
        defaultValue: f.default_value ? String(f.default_value) : null,
        isCustom: f.fieldname.startsWith('custom_'),
      });
    }

    if (entitiesToUpsert.length > 0) {
      const chunkSize = 30;
      for (let i = 0; i < entitiesToUpsert.length; i += chunkSize) {
        const chunk = entitiesToUpsert.slice(i, i + chunkSize);
        await this.erpnextProductFieldRepo.upsert(chunk, ['name']);
      }

      // Cleanup: Delete any local ERPNext fields that are no longer present in ERPNext
      const activeNames = entitiesToUpsert.map(e => e.name);
      await this.erpnextProductFieldRepo.delete({
        name: Not(In(activeNames))
      });
    }

    return { message: 'ERPNext fields synced successfully', count: entitiesToUpsert.length };
  }

  async getErpnextDocTypeSchema(doctype: string) {
    try {
      const result = await this.erpnextConnector.getDocTypeFields(doctype);
      if (!result.success || !result.data || !Array.isArray(result.data)) {
        return [];
      }

      const validFields = result.data.filter((f: any) => !['Column Break', 'Section Break', 'Tab Break', 'HTML', 'Heading', 'Fold'].includes(f.fieldtype));
      
      return validFields.map((f: any) => ({
        label: f.label || this.formatLabel(f.fieldname),
        value: f.fieldname,
        fieldtype: f.fieldtype,
      }));
    } catch (err: any) {
      this.logger.error(`getErpnextDocTypeSchema error for ${doctype}: ${err.message}`);
      return [];
    }
  }

  async updateErpnextField(id: string, dto: { amazonTemplate?: string; flipkartTemplate?: string }) {
    await this.erpnextProductFieldRepo.update(id, dto);
    return this.erpnextProductFieldRepo.findOne({ where: { id } });
  }

  async getErpnextFields(page?: number, limit?: number, search?: string) {
    if (page !== undefined || limit !== undefined || search !== undefined) {
      const pageNum = page || 1;
      const limitNum = limit || 50;
      const skip = (pageNum - 1) * limitNum;

      const [data, total] = await this.erpnextProductFieldRepo.findAndCount({
        where: search
          ? [
            { name: ILike(`%${search}%`) },
            { label: ILike(`%${search}%`) },
            { fieldtype: ILike(`%${search}%`) },
          ]
          : undefined,
        order: { name: 'ASC' },
        skip,
        take: limitNum,
      });

      return {
        data,
        total,
        page: pageNum,
        limit: limitNum,
      };
    }

    const fields = await this.erpnextProductFieldRepo.find({
      order: { label: 'ASC' },
    });

    return fields.map(f => ({
      label: f.label,
      value: f.name,
      fieldtype: f.fieldtype,
      options: f.options,
    }));
  }

  private formatLabel(key: string): string {
    // Converts snake_case or camelCase to Title Case
    const result = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
    return result.charAt(0).toUpperCase() + result.slice(1).trim();
  }
}
