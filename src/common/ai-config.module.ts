import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConfig } from '../database/entities/ai.entity';
import { AiSettingsService } from './services/ai-settings.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([AiConfig]),
    ConfigModule,
  ],
  providers: [AiSettingsService],
  exports: [AiSettingsService],
})
export class AiConfigModule {}
