import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MappingService } from './mapping.service';
import { MappingController } from './mapping.controller';
import { FieldMapping } from '../../database/entities/mapping.entity';
import { Product } from '../../database/entities/product.entity';
import { AmazonProductField } from '../../database/entities/amazon-product-field.entity';
import { ErpnextProductField } from '../../database/entities/erpnext-product-field.entity';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FieldMapping, Product, AmazonProductField, ErpnextProductField]),
    ERPNextModule
  ],
  controllers: [MappingController],
  providers: [MappingService],
  exports: [MappingService],
})
export class MappingModule {}
