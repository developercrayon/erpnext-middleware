import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ProductsController } from './products.controller';
import { ProductsWebhookController } from './webhooks.controller';
import { ProductsService } from './products.service';
import { Product } from '../../database/entities/product.entity';
import { QueueJob } from '../../database/entities/operational.entity';
import { WebhookLog } from '../../database/entities/logs.entity';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AuthModule } from '../auth/auth.module';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';
import { AmazonModule } from '../connectors/amazon/amazon.module';
import { FlipkartModule } from '../connectors/flipkart/flipkart.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, QueueJob, WebhookLog]),
    BullModule.registerQueue({ name: QUEUE_NAMES.PRODUCTS }),
    AuthModule,
    ERPNextModule,
    AmazonModule,
    FlipkartModule,
  ],
  controllers: [ProductsController, ProductsWebhookController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
