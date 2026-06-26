import { Module } from '@nestjs/common';
import { SharedModule } from '../../../shared/shared.module';
import { AmazonConnector } from './amazon.connector';

@Module({
  imports: [SharedModule],
  providers: [AmazonConnector],
  exports: [AmazonConnector],
})
export class AmazonModule {}
