import { Module } from '@nestjs/common';
import { PurchasingERPNextModule } from '../purchasing-erpnext/erpnext.module';
import { SupplierMatchingService } from './supplier-matching.service';
import { ItemMatchingService } from './item-matching.service';

@Module({
  imports: [PurchasingERPNextModule],
  providers: [SupplierMatchingService, ItemMatchingService],
  exports: [SupplierMatchingService, ItemMatchingService],
})
export class MatchingModule {}
