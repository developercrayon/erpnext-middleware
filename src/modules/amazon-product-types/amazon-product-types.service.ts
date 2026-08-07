import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { AmazonProductType } from '../../database/entities/amazon-product-type.entity';
import { AmazonProductField } from '../../database/entities/amazon-product-field.entity';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

@Injectable()
export class AmazonProductTypesService {
  private readonly logger = new Logger(AmazonProductTypesService.name);

  constructor(
    @InjectRepository(AmazonProductType)
    private readonly typeRepo: Repository<AmazonProductType>,
    @InjectRepository(AmazonProductField)
    private readonly fieldRepo: Repository<AmazonProductField>,
    @InjectQueue(QUEUE_NAMES.AMAZON_PRODUCT_TYPES)
    private readonly amazonProductTypesQueue: Queue,
  ) {}

  async getProductTypes(page: number, limit: number, search?: string) {
    const whereCondition = search ? { name: require('typeorm').ILike(`%${search}%`) } : {};
    const [data, total] = await this.typeRepo.findAndCount({
      where: whereCondition,
      skip: (page - 1) * limit,
      take: limit,
      order: { name: 'ASC' },
    });
    return { data, total, page, limit };
  }

  async syncProductTypes() {
    this.logger.log('Queueing job to sync Amazon Product Types');
    const job = await this.amazonProductTypesQueue.add(JOB_NAMES.FETCH_AMAZON_PRODUCT_TYPES, {});
    return { success: true, jobId: job.id, message: 'Sync job queued' };
  }

  async getProductFields(productTypeName: string, page: number, limit: number) {
    const [data, total] = await this.fieldRepo.findAndCount({
      where: { productTypeName },
      skip: (page - 1) * limit,
      take: limit,
      order: { name: 'ASC' },
    });
    return { data, total, page, limit };
  }

  async syncProductFields(productTypeName: string) {
    this.logger.log(`Queueing job to sync Amazon Product Fields for ${productTypeName}`);
    const job = await this.amazonProductTypesQueue.add(JOB_NAMES.FETCH_AMAZON_PRODUCT_FIELDS, { productType: productTypeName });
    return { success: true, jobId: job.id, message: 'Sync job queued' };
  }

  async getVariationThemes(productTypeName: string) {
    const productType = await this.typeRepo.findOne({ where: { name: productTypeName } });
    if (!productType || !productType.rawSchema) {
      return [];
    }

    const schema = productType.rawSchema.downloadedSchema || productType.rawSchema.schema || productType.rawSchema;
    if (!schema) return [];

    const themes = new Set<string>();

    const extractThemes = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;
      
      // Match structure: variation_theme.properties.name.enum
      if (obj.variation_theme?.properties?.name?.enum && Array.isArray(obj.variation_theme.properties.name.enum)) {
        obj.variation_theme.properties.name.enum.forEach((val: string) => themes.add(val));
      }
      
      // Match structure: variation_theme.contains.properties.name.enum (used in newer schemas)
      if (obj.variation_theme?.contains?.properties?.name?.enum && Array.isArray(obj.variation_theme.contains.properties.name.enum)) {
        obj.variation_theme.contains.properties.name.enum.forEach((val: string) => themes.add(val));
      }

      // Recursively search children
      for (const key of Object.keys(obj)) {
        extractThemes(obj[key]);
      }
    };

    extractThemes(schema);

    return Array.from(themes).sort();
  }
}
