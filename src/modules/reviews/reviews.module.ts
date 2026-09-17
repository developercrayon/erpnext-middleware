import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewSession } from '../../database/entities/review-session.entity';
import { Review } from '../../database/entities/review.entity';
import { ReviewMedia } from '../../database/entities/review-media.entity';
import { ReviewEvent } from '../../database/entities/review-event.entity';
import { ReviewAiAnalysis } from '../../database/entities/review-ai-analysis.entity';
import { AiModule } from '../ai/ai.module';

import { ReviewsController } from './reviews.controller';
import { ReviewsAdminController } from './reviews-admin.controller';
import { ReviewsService } from './services/reviews.service';
import { ReviewQrService } from './services/review-qr.service';
import { ReviewAIService } from './services/review-ai.service';
import { ReviewMediaService } from './services/review-media.service';
import { ReviewNotificationService } from './services/review-notification.service';
import { ReviewSettingsService } from './services/review-settings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReviewSession,
      Review,
      ReviewMedia,
      ReviewEvent,
      ReviewAiAnalysis,
    ]),
    AiModule,
  ],
  controllers: [ReviewsController, ReviewsAdminController],
  providers: [
    ReviewsService,
    ReviewQrService,
    ReviewAIService,
    ReviewMediaService,
    ReviewNotificationService,
    ReviewSettingsService,
  ],
  exports: [
    ReviewsService,
    ReviewQrService,
    ReviewAIService,
    ReviewMediaService,
    ReviewNotificationService,
    ReviewSettingsService,
  ],
})
export class ReviewsModule {}
