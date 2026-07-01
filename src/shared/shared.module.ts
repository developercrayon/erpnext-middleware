import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpClientService } from './http-client.service';
import { ApiLog } from '../database/entities/logs.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApiLog])],
  providers: [HttpClientService],
  exports: [HttpClientService],
})
export class SharedModule {}
