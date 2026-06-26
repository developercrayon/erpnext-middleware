import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { Order } from '../../database/entities/order.entity';
import { OrderItem } from '../../database/entities/order-item.entity';
import { WebhookLog } from '../../database/entities/logs.entity';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AuthModule } from '../auth/auth.module';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';
import { AmazonModule } from '../connectors/amazon/amazon.module';
import { FlipkartModule } from '../connectors/flipkart/flipkart.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, WebhookLog]),
    BullModule.registerQueue({ name: QUEUE_NAMES.ORDERS }),
    AuthModule,
    ERPNextModule,
    AmazonModule,
    FlipkartModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
