import { Module } from '@nestjs/common';
import { SharedModule } from '../../../shared/shared.module';
import { FlipkartConnector } from './flipkart.connector';

@Module({
  imports: [SharedModule],
  providers: [FlipkartConnector],
  exports: [FlipkartConnector],
})
export class FlipkartModule {}
