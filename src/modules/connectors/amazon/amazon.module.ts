import { Module } from '@nestjs/common';
import { SharedModule } from '../../../shared/shared.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldMapping } from '../../../database/entities/mapping.entity';
import { ErpnextProductField } from '../../../database/entities/erpnext-product-field.entity';
import { Unit } from '../../../database/entities/unit.entity';
import { Country } from '../../../database/entities/country.entity';
import { AmazonConnector } from './amazon.connector';
import { AmazonVariantMapping } from '../../../database/entities/amazon-variant-mapping.entity';

@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([FieldMapping, ErpnextProductField, Unit, Country, AmazonVariantMapping])],
  providers: [AmazonConnector],
  exports: [AmazonConnector],
})
export class AmazonModule {}
