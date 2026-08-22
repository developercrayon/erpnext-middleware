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
import { SystemProcessor } from './processors/system.processor';
import { QueueListenerService } from './queue.listener';
import { OrdersModule } from '../orders/orders.module';
import { ProductsModule } from '../products/products.module';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';
import { AmazonModule } from '../connectors/amazon/amazon.module';
import { FlipkartModule } from '../connectors/flipkart/flipkart.module';
import { OrderFieldMappingModule } from '../order-field-mapping/order-field-mapping.module';
import { QueueJob, SyncHistory, ItemSyncLog } from '../../database/entities/operational.entity';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';
import { ErrorLog, ApiLog, WebhookLog, ConnectorLog } from '../../database/entities/logs.entity';
import { Inventory } from '../../database/entities/inventory.entity';

const queues = Object.values(QUEUE_NAMES).map((name) =>
  BullModule.registerQueueAsync({
    name,
    imports: [ConfigModule],
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const redisUrl = config.get<string>('redis.url');
      return {
        ...(redisUrl ? { url: redisUrl } : {
          redis: {
            host: config.get<string>('redis.host'),
            port: config.get<number>('redis.port'),
            password: config.get<string>('redis.password'),
            db: config.get<number>('redis.db'),
            maxRetriesPerRequest: null,
          }
        }),
        defaultJobOptions: {
          attempts: 1, // No retries by default — 4xx errors would loop forever; increase per-job if needed
          backoff: {
            type: 'exponential',
            delay: config.get<number>('queues.retryDelay') || 5000,
          },
          removeOnComplete: { age: 86400, count: 1000 },
          removeOnFail: false,
        },
      };
    },
  }),
);

@Module({
  imports: [
    ...queues,
    TypeOrmModule.forFeature([
      QueueJob,
      ErrorLog,
      ApiLog,
      WebhookLog,
      ConnectorLog,
      Inventory,
      ItemSyncLog,
      SyncHistory,
    ]),
    OrdersModule,
    ProductsModule,
    ERPNextModule,
    AmazonModule,
    FlipkartModule,
    OrderFieldMappingModule,
  ],
  controllers: [QueueController],
  providers: [
    QueueService,
    OrdersProcessor,
    InventoryProcessor,
    PricingProcessor,
    ShipmentsProcessor,
    ProductsProcessor,
    RetryProcessor,
    SystemProcessor,
    QueueListenerService,
  ],
  exports: [BullModule],
})
export class QueueModule {}
