import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoiceDocument } from '../../database/entities/purchase-invoice-document.entity';
import { PurchaseInvoiceDocumentItem } from '../../database/entities/purchase-invoice-document-item.entity';
import { AIExtractionModule } from '../ai-extraction/ai-extraction.module';
import { MatchingModule } from '../matching/matching.module';
import { ValidationModule } from '../validation/validation.module';
import { AuditModule } from '../audit/audit.module';
import { DocumentProcessingService } from './document-processing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PurchaseInvoiceDocument, PurchaseInvoiceDocumentItem]),
    AIExtractionModule,
    MatchingModule,
    ValidationModule,
    AuditModule,
  ],
  providers: [DocumentProcessingService],
  exports: [DocumentProcessingService],
})
export class DocumentProcessingModule {}
