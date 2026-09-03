import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';

import configuration from './common/config/configuration';
import { createWinstonConfig } from './common/config/logger.config';
import { DatabaseModule } from './database/database.module';

// Connectors
import { ERPNextModule } from './modules/connectors/erpnext/erpnext.module';
import { AmazonModule } from './modules/connectors/amazon/amazon.module';
import { FlipkartModule } from './modules/connectors/flipkart/flipkart.module';
import { MappingModule } from './modules/mapping/mapping.module';
import { AmazonProductTypesModule } from './modules/amazon-product-types/amazon-product-types.module';
import { AmazonVariantMappingModule } from './modules/amazon-variant-mapping/amazon-variant-mapping.module';
import { ErpnextAttributesModule } from './modules/erpnext-attributes/erpnext-attributes.module';

// Business Modules
import { AuthModule } from './modules/auth/auth.module';
import { OrdersModule } from './modules/orders/orders.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductsModule } from './modules/products/products.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { LogsModule } from './modules/logs/logs.module';
import { UnitModule } from './modules/unit/unit.module';
import { CountryModule } from './modules/country/country.module';
import { OrderFieldMappingModule } from './modules/order-field-mapping/order-field-mapping.module';
import { ItemGroupModule } from './modules/item-group/item-group.module';

// Infrastructure
import { QueueModule } from './modules/queue/queue.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { AiModule } from './modules/ai/ai.module';
import { SocialPostsModule } from './modules/social-posts/social-posts.module';
import { HealthController } from './common/health/health.controller';
import { AppController } from './app.controller';

import { AdminModule } from './admin/admin.module';

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

    // ─── Queue (Global Config) ────────────────────────────────────────────────
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('redis.url');
        return {
          prefix: process.env.NODE_ENV === 'development' ? 'bull-local' : 'bull',
          ...(redisUrl ? { url: redisUrl } : {
            redis: {
              host: config.get<string>('redis.host') || 'localhost',
              port: config.get<number>('redis.port') || 6379,
              password: config.get<string>('redis.password'),
              db: config.get<number>('redis.db') || 0,
              maxRetriesPerRequest: null,
            }
          }),
        };
      },
    }),

    // ─── Database ─────────────────────────────────────────────────────────────
    DatabaseModule,

    // ─── Admin Dashboard ──────────────────────────────────────────────────────
    AdminModule.register(),

    // ─── Connectors ───────────────────────────────────────────────────────────
    ERPNextModule,
    AmazonModule,
    FlipkartModule,
    MappingModule,
    AmazonProductTypesModule,
    AmazonVariantMappingModule,
    ErpnextAttributesModule,

    // ─── Business Modules ─────────────────────────────────────────────────────
    AuthModule,
    OrdersModule,
    InventoryModule,
    ProductsModule,
    PricingModule,
    ShipmentsModule,
    LogsModule,
    UnitModule,
    CountryModule,
    OrderFieldMappingModule,
    ItemGroupModule,

    // ─── Infrastructure ───────────────────────────────────────────────────────
    QueueModule,
    SchedulerModule,
    AiModule,
    SocialPostsModule,
  ],
  controllers: [AppController, HealthController],
})
export class AppModule {}
