import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { SchedulerService } from './scheduler.service';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialPost } from '../../database/entities/social-post.entity';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.ORDERS },
      { name: QUEUE_NAMES.INVENTORY },
      { name: QUEUE_NAMES.PRICING },
      { name: QUEUE_NAMES.RETRY },
      { name: QUEUE_NAMES.SYSTEM },
      { name: QUEUE_NAMES.SOCIAL_POSTS },
    ),
    TypeOrmModule.forFeature([SocialPost]),
  ],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
