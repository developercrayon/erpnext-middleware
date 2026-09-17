import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';

// Import all sub-modules of the OCR system
import { AuditModule } from '../audit/audit.module';
import { AIExtractionModule } from '../ai-extraction/ai-extraction.module';
import { MatchingModule } from '../matching/matching.module';
import { ValidationModule } from '../validation/validation.module';
import { DocumentProcessingModule } from '../document-processing/document-processing.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { PurchasingERPNextModule } from '../purchasing-erpnext/erpnext.module';

@Module({
  imports: [
    // Static Files configuration localized to this module
    ServeStaticModule.forRoot({
      rootPath: path.resolve(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    
    // All OCR-specific modules bundled together
    AuditModule,
    AIExtractionModule,
    MatchingModule,
    ValidationModule,
    DocumentProcessingModule,
    PurchasingModule,
    ReviewsModule,
    PurchasingERPNextModule,
  ],
})
export class OcrIntegrationModule {}
