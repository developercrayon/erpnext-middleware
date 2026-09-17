import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoiceDocument } from '../../database/entities/purchase-invoice-document.entity';
import { PurchaseInvoiceDocumentItem } from '../../database/entities/purchase-invoice-document-item.entity';
import { DocumentProcessingModule } from '../document-processing/document-processing.module';
import { PurchasingERPNextModule } from '../purchasing-erpnext/erpnext.module';
import { ValidationModule } from '../validation/validation.module';
import { AuditModule } from '../audit/audit.module';
import { PurchasingService } from './purchasing.service';
import { PurchasingController } from './purchasing.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PurchaseInvoiceDocument, PurchaseInvoiceDocumentItem]),
    DocumentProcessingModule,
    PurchasingERPNextModule,
    ValidationModule,
    AuditModule,
  ],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
