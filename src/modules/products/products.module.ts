import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ProductsController } from './products.controller';
import { ProductsWebhookController } from './webhooks.controller';
import { ProductsService } from './products.service';
import { FieldMapping } from '../../database/entities/mapping.entity';
import { ErpnextProductField } from '../../database/entities/erpnext-product-field.entity';
import { Product } from '../../database/entities/product.entity';
import { Country } from '../../database/entities/country.entity';
import { QueueJob } from '../../database/entities/operational.entity';
import { WebhookLog, ErrorLog } from '../../database/entities/logs.entity';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AuthModule } from '../auth/auth.module';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';
import { AmazonModule } from '../connectors/amazon/amazon.module';
import { FlipkartModule } from '../connectors/flipkart/flipkart.module';
import { PricingModule } from '../pricing/pricing.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, QueueJob, WebhookLog, ErrorLog, FieldMapping, ErpnextProductField, Country]),
    BullModule.registerQueue({ name: QUEUE_NAMES.PRODUCTS }),
    AuthModule,
    ERPNextModule,
    AmazonModule,
    FlipkartModule,
    PricingModule,
    InventoryModule,
  ],
  controllers: [ProductsController, ProductsWebhookController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
