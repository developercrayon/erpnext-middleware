import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AmazonVariantMapping } from '../../database/entities/amazon-variant-mapping.entity';
import { AmazonVariantMappingService } from './amazon-variant-mapping.service';
import { AmazonVariantMappingController } from './amazon-variant-mapping.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AmazonVariantMapping])],
  providers: [AmazonVariantMappingService],
  controllers: [AmazonVariantMappingController],
  exports: [AmazonVariantMappingService],
})
export class AmazonVariantMappingModule {}
