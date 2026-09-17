import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ErpSupplier } from '../../database/entities/erp-supplier.entity';
import { ErpItem } from '../../database/entities/erp-item.entity';
import { ErpNextService } from './erpnext.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ErpSupplier, ErpItem]),
  ],
  providers: [ErpNextService],
  exports: [ErpNextService],
})
export class PurchasingERPNextModule implements OnModuleInit {
  constructor(private readonly erpService: ErpNextService) {}

  async onModuleInit() {
    await this.erpService.seedDefaultMasterDataIfEmpty();
  }
}
