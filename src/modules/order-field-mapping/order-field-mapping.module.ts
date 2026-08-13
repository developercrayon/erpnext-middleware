import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderFieldMappingController } from './order-field-mapping.controller';
import { OrderFieldMappingService } from './order-field-mapping.service';
import { OrderFieldMapping } from '../../database/entities/order-field-mapping.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OrderFieldMapping])],
  controllers: [OrderFieldMappingController],
  providers: [OrderFieldMappingService],
  exports: [OrderFieldMappingService],
})
export class OrderFieldMappingModule {}
