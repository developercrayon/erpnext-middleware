import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { ShipmentSync } from '../../database/entities/sync.entity';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AuthModule } from '../auth/auth.module';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';
import { AmazonModule } from '../connectors/amazon/amazon.module';
import { FlipkartModule } from '../connectors/flipkart/flipkart.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShipmentSync]),
    BullModule.registerQueue({ name: QUEUE_NAMES.SHIPMENTS }),
    AuthModule,
    ERPNextModule,
    AmazonModule,
    FlipkartModule,
    forwardRef(() => OrdersModule),
  ],
  controllers: [ShipmentsController],
  providers: [ShipmentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule {}
