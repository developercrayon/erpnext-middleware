import { Module } from '@nestjs/common';
import { SharedModule } from '../../../shared/shared.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FieldMapping } from '../../../database/entities/mapping.entity';
import { AmazonConnector } from './amazon.connector';

@Module({
  imports: [SharedModule, TypeOrmModule.forFeature([FieldMapping])],
  providers: [AmazonConnector],
  exports: [AmazonConnector],
})
export class AmazonModule {}
