import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Product } from '../../database/entities/product.entity';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AuthModule } from '../auth/auth.module';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';
import { AmazonModule } from '../connectors/amazon/amazon.module';
import { FlipkartModule } from '../connectors/flipkart/flipkart.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product]),
    BullModule.registerQueue({ name: QUEUE_NAMES.PRODUCTS }),
    AuthModule,
    ERPNextModule,
    AmazonModule,
    FlipkartModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
