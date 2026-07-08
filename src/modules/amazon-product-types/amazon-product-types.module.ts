import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AmazonProductTypesController } from './amazon-product-types.controller';
import { AmazonProductTypesService } from './amazon-product-types.service';
import { AmazonProductTypesProcessor } from './amazon-product-types.processor';
import { AmazonProductType } from '../../database/entities/amazon-product-type.entity';
import { AmazonProductField } from '../../database/entities/amazon-product-field.entity';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AmazonModule } from '../connectors/amazon/amazon.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AmazonProductType, AmazonProductField]),
    BullModule.registerQueue({
      name: QUEUE_NAMES.AMAZON_PRODUCT_TYPES,
    }),
    AmazonModule,
  ],
  controllers: [AmazonProductTypesController],
  providers: [AmazonProductTypesService, AmazonProductTypesProcessor],
  exports: [AmazonProductTypesService],
})
export class AmazonProductTypesModule {}
