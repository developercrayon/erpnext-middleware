import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';
import { ConnectorLog, WebhookLog, ApiLog, ErrorLog } from '../../database/entities/logs.entity';
import { SyncHistory } from '../../database/entities/operational.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConnectorLog, WebhookLog, ApiLog, ErrorLog, SyncHistory]),
    AuthModule,
  ],
  controllers: [LogsController],
  providers: [LogsService],
  exports: [LogsService],
})
export class LogsModule {}
