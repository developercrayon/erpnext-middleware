import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AIInvoiceExtractionService } from './ai-invoice-extraction.service';

@Module({
  imports: [AiModule],
  providers: [AIInvoiceExtractionService],
  exports: [AIInvoiceExtractionService],
})
export class AIExtractionModule {}
export { AIExtractionModule as AIInvoiceExtractionModule };
