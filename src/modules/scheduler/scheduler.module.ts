import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { SchedulerService } from './scheduler.service';
import { QUEUE_NAMES } from '../queue/queue.constants';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.ORDERS },
      { name: QUEUE_NAMES.INVENTORY },
      { name: QUEUE_NAMES.PRICING },
      { name: QUEUE_NAMES.RETRY },
    ),
  ],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
