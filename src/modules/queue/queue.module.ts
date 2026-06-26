import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QUEUE_NAMES } from './queue.constants';
import { OrdersProcessor } from './processors/orders.processor';
import { InventoryProcessor } from './processors/inventory.processor';
import { PricingProcessor } from './processors/pricing.processor';
import { ShipmentsProcessor } from './processors/shipments.processor';
import { ProductsProcessor } from './processors/products.processor';
import { RetryProcessor } from './processors/retry.processor';
import { OrdersModule } from '../orders/orders.module';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';
import { AmazonModule } from '../connectors/amazon/amazon.module';
import { FlipkartModule } from '../connectors/flipkart/flipkart.module';
import { QueueJob } from '../../database/entities/operational.entity';
import { ErrorLog } from '../../database/entities/logs.entity';
import { Inventory, InventorySync } from '../../database/entities/inventory.entity';
import { PriceSync, ShipmentSync } from '../../database/entities/sync.entity';
import { Product } from '../../database/entities/product.entity';

const queues = Object.values(QUEUE_NAMES).map((name) =>
  BullModule.registerQueueAsync({
    name,
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (config: ConfigService) => ({
      redis: {
        host: config.get<string>('redis.host'),
        port: config.get<number>('redis.port'),
        password: config.get<string>('redis.password'),
        db: config.get<number>('redis.db'),
      },
      defaultJobOptions: {
        attempts: config.get<number>('queues.maxRetries') || 3,
        backoff: {
          type: 'exponential',
          delay: config.get<number>('queues.retryDelay') || 5000,
        },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: false,
      },
    }),
  }),
);

@Module({
  imports: [
    ...queues,
    TypeOrmModule.forFeature([
      QueueJob,
      ErrorLog,
      Inventory,
      InventorySync,
      PriceSync,
      ShipmentSync,
      Product,
    ]),
    OrdersModule,
    ERPNextModule,
    AmazonModule,
    FlipkartModule,
  ],
  providers: [
    OrdersProcessor,
    InventoryProcessor,
    PricingProcessor,
    ShipmentsProcessor,
    ProductsProcessor,
    RetryProcessor,
  ],
  exports: [BullModule],
})
export class QueueModule {}
