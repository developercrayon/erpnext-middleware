import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalesOrderDocument } from '../../database/entities/sales-order-document.entity';
import { SalesOrderItem } from '../../database/entities/sales-order-item.entity';
import { ErpCustomer } from '../../database/entities/erp-customer.entity';
import { ErpItem } from '../../database/entities/erp-item.entity';
import { AiConfig } from '../../database/entities/ai.entity';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderService } from './services/sales-order.service';
import { SalesOrderErpNextService } from './services/sales-order-erpnext.service';
import { SalesOrderAiService } from './services/sales-order-ai.service';
import { AuditModule } from '../audit/audit.module';
import { AiConfigModule } from '../../common/ai-config.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SalesOrderDocument,
      SalesOrderItem,
      ErpCustomer,
      ErpItem,
      AiConfig,
    ]),
    AuditModule,
    AiConfigModule,
  ],
  controllers: [SalesOrderController],
  providers: [
    SalesOrderService,
    SalesOrderErpNextService,
    SalesOrderAiService,
  ],
  exports: [
    SalesOrderService,
    SalesOrderErpNextService,
    SalesOrderAiService,
  ],
})
export class SalesOrderModule {}
