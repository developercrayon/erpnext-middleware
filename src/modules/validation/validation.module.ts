import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PurchaseInvoiceDocument } from '../../database/entities/purchase-invoice-document.entity';
import { InvoiceValidationService } from './invoice-validation.service';

@Module({
  imports: [TypeOrmModule.forFeature([PurchaseInvoiceDocument])],
  providers: [InvoiceValidationService],
  exports: [InvoiceValidationService],
})
export class ValidationModule {}
