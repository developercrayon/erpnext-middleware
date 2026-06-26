import { Module } from '@nestjs/common';
import { SharedModule } from '../../../shared/shared.module';
import { ERPNextConnector } from './erpnext.connector';
import { ERPNextService } from './erpnext.service';

@Module({
  imports: [SharedModule],
  providers: [ERPNextConnector, ERPNextService],
  exports: [ERPNextConnector, ERPNextService],
})
export class ERPNextModule {}
