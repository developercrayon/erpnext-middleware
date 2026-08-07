import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ErpnextAttribute } from '../../database/entities/erpnext-attribute.entity';
import { ErpnextAttributesService } from './erpnext-attributes.service';
import { ErpnextAttributesController } from './erpnext-attributes.controller';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ErpnextAttribute]),
    ERPNextModule,
  ],
  providers: [ErpnextAttributesService],
  controllers: [ErpnextAttributesController],
  exports: [ErpnextAttributesService],
})
export class ErpnextAttributesModule {}
