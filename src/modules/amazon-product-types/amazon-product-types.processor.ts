import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { AmazonConnector } from '../connectors/amazon/amazon.connector';
import { AmazonProductType } from '../../database/entities/amazon-product-type.entity';
import { AmazonProductField } from '../../database/entities/amazon-product-field.entity';

@Processor(QUEUE_NAMES.AMAZON_PRODUCT_TYPES)
export class AmazonProductTypesProcessor {
  private readonly logger = new Logger(AmazonProductTypesProcessor.name);

  constructor(
    private readonly amazonConnector: AmazonConnector,
    @InjectRepository(AmazonProductType)
    private readonly typeRepo: Repository<AmazonProductType>,
    @InjectRepository(AmazonProductField)
    private readonly fieldRepo: Repository<AmazonProductField>,
  ) {}

  @Process(JOB_NAMES.FETCH_AMAZON_PRODUCT_TYPES)
  async fetchProductTypes(job: Job): Promise<void> {
    this.logger.log('Executing background job: Fetch Amazon Product Types');
    const result = await this.amazonConnector.fetchProductTypes();
    if (!result.success) {
      throw new Error(`Failed to fetch product types: ${result.error}`);
    }

    const types = result.data || [];
    let saved = 0;
    for (const type of types) {
      try {
        await this.typeRepo.save({
          name: type,
        });
        saved++;
      } catch (err) {
        this.logger.error(`Error saving product type ${type}: ${err.message}`);
      }
    }
    this.logger.log(`Successfully synced ${saved} product types`);
  }

  @Process(JOB_NAMES.FETCH_AMAZON_PRODUCT_FIELDS)
  async fetchProductFields(job: Job): Promise<void> {
    const { productType } = job.data;
    if (!productType) throw new Error('productType is required for fetching fields');

    this.logger.log(`Executing background job: Fetch Amazon Product Fields for ${productType}`);
    const result = await this.amazonConnector.fetchProductFields(productType);
    if (!result.success) {
      throw new Error(`Failed to fetch fields for ${productType}: ${result.error}`);
    }

    const schema = result.data?.schema;
    if (!schema || !schema.properties) {
       this.logger.warn(`No schema properties found for product type ${productType}`);
       return;
    }

    const requiredFields = schema.required || [];
    const properties = schema.properties;
    
    // Clear existing fields for this product type to avoid stale data
    await this.fieldRepo.delete({ productTypeName: productType });

    let saved = 0;
    for (const [key, value] of Object.entries(properties)) {
       try {
         const isRequired = requiredFields.includes(key);
         const val = value as any;
         await this.fieldRepo.save({
            name: key,
            label: val.title || key,
            isRequired,
            schema: val,
            productTypeName: productType,
         });
         saved++;
       } catch (err) {
         this.logger.error(`Error saving field ${key} for ${productType}: ${err.message}`);
       }
    }
    
    this.logger.log(`Successfully synced ${saved} fields for product type ${productType}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job): void {
    if (job.name === JOB_NAMES.FETCH_AMAZON_PRODUCT_TYPES || job.name === JOB_NAMES.FETCH_AMAZON_PRODUCT_FIELDS) {
       this.logger.debug(`Job ${job.id} (${job.name}) completed successfully.`);
    }
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error): void {
    if (job.name === JOB_NAMES.FETCH_AMAZON_PRODUCT_TYPES || job.name === JOB_NAMES.FETCH_AMAZON_PRODUCT_FIELDS) {
       this.logger.error(`Job ${job.id} (${job.name}) failed: ${error.message}`);
    }
  }
}
