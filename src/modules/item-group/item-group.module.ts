import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ItemGroupConfig, ItemGroupPrompt } from '../../database/entities/item-group.entity';
import { ItemGroupController } from './item-group.controller';
import { ItemGroupService } from './item-group.service';
import { ERPNextModule } from '../connectors/erpnext/erpnext.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ItemGroupConfig, ItemGroupPrompt]),
    ERPNextModule,
  ],
  controllers: [ItemGroupController],
  providers: [ItemGroupService],
  exports: [ItemGroupService],
})
export class ItemGroupModule {}
