import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { ThrottlerModule } from '@nestjs/throttler';

import configuration from './common/config/configuration';
import { createWinstonConfig } from './common/config/logger.config';
import { DatabaseModule } from './database/database.module';

// Connectors
import { ERPNextModule } from './modules/connectors/erpnext/erpnext.module';
import { AmazonModule } from './modules/connectors/amazon/amazon.module';
import { FlipkartModule } from './modules/connectors/flipkart/flipkart.module';

// Business Modules
import { AuthModule } from './modules/auth/auth.module';
import { OrdersModule } from './modules/orders/orders.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductsModule } from './modules/products/products.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { LogsModule } from './modules/logs/logs.module';

// Infrastructure
import { QueueModule } from './modules/queue/queue.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { HealthController } from './common/health/health.controller';

@Module({
  imports: [
    // ─── Config ─────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '.env.local'],
    }),

    // ─── Logger ──────────────────────────────────────────────────────────────
    WinstonModule.forRoot(
      createWinstonConfig(
        process.env.LOG_DIR || './logs',
        process.env.LOG_LEVEL || 'debug',
        process.env.LOG_MAX_FILES || '14d',
        process.env.LOG_MAX_SIZE || '20m',
      ),
    ),

    // ─── Rate Limiting ────────────────────────────────────────────────────────
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL || '60', 10) * 1000,
        limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
      },
    ]),

    // ─── Database ─────────────────────────────────────────────────────────────
    DatabaseModule,

    // ─── Connectors ───────────────────────────────────────────────────────────
    ERPNextModule,
    AmazonModule,
    FlipkartModule,

    // ─── Business Modules ─────────────────────────────────────────────────────
    AuthModule,
    OrdersModule,
    InventoryModule,
    ProductsModule,
    PricingModule,
    ShipmentsModule,
    LogsModule,

    // ─── Infrastructure ───────────────────────────────────────────────────────
    QueueModule,
    SchedulerModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
