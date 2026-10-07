import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesInvoiceDocument } from '../../database/entities/sales-invoice-document.entity';
import { SalesInvoiceItem } from '../../database/entities/sales-invoice-item.entity';
import { SalesInvoiceController } from './sales-invoice.controller';
import { SalesInvoiceService } from './services/sales-invoice.service';
import { SalesInvoiceErpNextService } from './services/sales-invoice-erpnext.service';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { AuditModule } from '../audit/audit.module';
import { AiConfigModule } from '../../common/ai-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesInvoiceDocument,
      SalesInvoiceItem,
    ]),
    SalesOrderModule,
    AuditModule,
    AiConfigModule,
  ],
  controllers: [SalesInvoiceController],
  providers: [
    SalesInvoiceService,
    SalesInvoiceErpNextService,
  ],
  exports: [
    SalesInvoiceService,
    SalesInvoiceErpNextService,
  ],
})
export class SalesInvoiceModule {}
