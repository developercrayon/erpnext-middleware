import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ReviewsService } from './services/reviews.service';
import { ReviewSettingsService, ReviewSettingsDto } from './services/review-settings.service';
import { ModerateReviewDto } from './dto/moderate-review.dto';
import { ReviewStatus } from '../../common/enums/review.enums';

@Controller('reviews-admin')
export class ReviewsAdminController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly settingsService: ReviewSettingsService,
  ) {}

  @Get('settings')
  async getSettings(): Promise<ReviewSettingsDto> {
    return this.settingsService.getSettings();
  }

  @Post('settings')
  async saveSettings(@Body() body: Partial<ReviewSettingsDto>): Promise<ReviewSettingsDto> {
    return this.settingsService.saveSettings(body);
  }

  @Get()
  async getReviews(
    @Query('status') status?: string,
    @Query('rating') rating?: number,
    @Query('source') source?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
    @Query('hasMedia') hasMedia?: string,
    @Query('aiGenerated') aiGenerated?: string,
  ) {
    return await this.reviewsService.getAllReviewsForAdmin({
      status,
      rating,
      source,
      search,
      page,
      limit,
      sortBy,
      sortOrder,
      hasMedia: hasMedia === 'true',
      aiGenerated: aiGenerated === 'true' ? true : aiGenerated === 'false' ? false : undefined,
    });
  }

  @Get('orders-list')
  async getOrderReviews(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return await this.reviewsService.getAllOrderReviewsForAdmin({
      search,
      status,
      page,
      limit,
    });
  }

  @Get('analytics/summary')
  async getAnalytics() {
    return await this.reviewsService.getAnalyticsSummary();
  }

  @Post('batch-moderate')
  async batchModerate(
    @Body() body: { ids: string[]; action: 'approve' | 'publish' | 'reject' | 'delete' },
  ) {
    return await this.reviewsService.batchModerateReviews(body.ids, body.action);
  }

  @Get('orders/:orderId')
  async getReviewsForOrder(@Param('orderId') orderId: string) {
    return await this.reviewsService.getReviewsForOrder(orderId);
  }

  @Get(':id')
  async getReviewDetail(@Param('id') id: string) {
    return await this.reviewsService.getReviewDetailForAdmin(id);
  }

  @Patch(':id/moderate')
  async moderateReview(
    @Param('id') id: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return await this.reviewsService.moderateReview(id, dto);
  }

  @Patch(':id')
  async updateReview(
    @Param('id') id: string,
    @Body() body: { title?: string; content?: string; rating?: number; status?: ReviewStatus },
  ) {
    return await this.reviewsService.updateReviewAdmin(id, body);
  }

  @Delete('orders-list/:sessionId')
  async deleteOrderReviewSession(@Param('sessionId') sessionId: string) {
    return await this.reviewsService.deleteOrderReviewSessionAdmin(sessionId);
  }

  @Delete(':id')
  async deleteReview(@Param('id') id: string) {
    return await this.reviewsService.deleteReviewAdmin(id);
  }

  @Post(':id/re-analyze')
  async reAnalyzeReview(@Param('id') id: string) {
    return await this.reviewsService.reAnalyzeReview(id);
  }

  @Post(':id/approve')
  async approveReview(@Param('id') id: string) {
    return await this.reviewsService.moderateReview(id, {
      status: ReviewStatus.APPROVED,
    });
  }

  @Post(':id/publish')
  async publishReview(@Param('id') id: string) {
    return await this.reviewsService.moderateReview(id, {
      status: ReviewStatus.PUBLISHED,
    });
  }

  @Post(':id/reject')
  async rejectReview(@Param('id') id: string) {
    return await this.reviewsService.moderateReview(id, {
      status: ReviewStatus.REJECTED,
    });
  }
}
