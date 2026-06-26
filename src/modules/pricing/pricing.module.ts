import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { PriceSync } from '../../database/entities/sync.entity';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AuthModule } from '../auth/auth.module';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';
import { AmazonModule } from '../connectors/amazon/amazon.module';
import { FlipkartModule } from '../connectors/flipkart/flipkart.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PriceSync]),
    BullModule.registerQueue({ name: QUEUE_NAMES.PRICING }),
    AuthModule,
    ERPNextModule,
    AmazonModule,
    FlipkartModule,
  ],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
