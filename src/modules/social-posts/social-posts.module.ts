import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { SocialPost } from '../../database/entities/social-post.entity';
import { SocialCampaign } from '../../database/entities/social-campaign.entity';
import { SocialPostsController } from './social-posts.controller';
import { SocialPostsService } from './social-posts.service';
import { SocialPostsProcessor } from './social-posts.processor';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { AiModule } from '../ai/ai.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SocialPost, SocialCampaign]),
    BullModule.registerQueue({
      name: QUEUE_NAMES.AI,
    }),
    AiModule,
    ProductsModule,
  ],
  controllers: [SocialPostsController],
  providers: [SocialPostsService, SocialPostsProcessor],
  exports: [SocialPostsService],
})
export class SocialPostsModule {}
