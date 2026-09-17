import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ReviewsService } from './services/reviews.service';
import { ReviewAIService } from './services/review-ai.service';
import { ReviewMediaService } from './services/review-media.service';
import { ReviewQrService } from './services/review-qr.service';
import { SubmitRatingDto } from './dto/submit-rating.dto';
import { GenerateAiReviewDto, GenerateOverallAiReviewDto } from './dto/generate-ai-review.dto';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { TrackEventDto } from './dto/track-event.dto';
import { CreateReviewSessionDto } from './dto/create-review-session.dto';
import { CreateOrderWithSessionDto } from './dto/create-order-with-session.dto';

import { ReviewSettingsService } from './services/review-settings.service';

@Controller(['reviews', 'api/reviews'])
export class ReviewsController {
  constructor(
    private readonly reviewsService: ReviewsService,
    private readonly aiService: ReviewAIService,
    private readonly mediaService: ReviewMediaService,
    private readonly qrService: ReviewQrService,
    private readonly settingsService: ReviewSettingsService,
  ) {}

  @Get('public-settings')
  async getPublicSettings() {
    return this.settingsService.getSettings();
  }

  @Get('orders/erp-orders')
  async getErpSalesOrders() {
    return await this.reviewsService.getErpSalesOrders();
  }

  @Post('orders/create-with-session')
  async createOrderWithSession(@Body() dto: CreateOrderWithSessionDto) {
    const orderData = await this.reviewsService.createOrderWithSession(dto);
    const token = orderData.session.token;
    const qrDataUrl = await this.qrService.generateQrDataUrl(token, 'INVOICE');
    return {
      ...orderData,
      reviewUrl: this.qrService.getReviewUrl(token, 'DIRECT'),
      qrReviewUrl: this.qrService.getReviewUrl(token, 'INVOICE'),
      whatsappReviewUrl: this.qrService.getReviewUrl(token, 'WHATSAPP'),
      emailReviewUrl: this.qrService.getReviewUrl(token, 'EMAIL'),
      qrDataUrl,
    };
  }


  @Get('session/:token')
  async resolveSession(
    @Param('token') token: string,
    @Query('source') source: string,
  ) {
    return await this.reviewsService.resolveSessionByToken(token, source || 'DIRECT');
  }

  @Post('session/:token/event')
  async trackEvent(
    @Param('token') token: string,
    @Body() dto: TrackEventDto,
  ) {
    return await this.reviewsService.trackEventByToken(token, dto);
  }

  @Post('session/:token/rating')
  async saveRating(
    @Param('token') token: string,
    @Body() dto: SubmitRatingDto,
  ) {
    return await this.reviewsService.saveDraftRating(token, dto);
  }

  @Post('session/:token/generate-ai')
  async generateAiPolish(
    @Param('token') token: string,
    @Body() dto: GenerateAiReviewDto,
  ) {
    return await this.aiService.polishCustomerReview({
      productName: dto.productName || 'Woodwolff Handcrafted Product',
      productCategory: dto.productCategory,
      description: dto.description,
      rating: dto.rating,
      rawInput: dto.rawInput,
      spokenText: dto.spokenText,
      uploadedPhotosCount: dto.uploadedPhotosCount,
      conversationHistory: dto.conversationHistory,
    });
  }

  @Post('session/:token/suggestions')
  async getProductSuggestions(
    @Param('token') token: string,
    @Body()
    body: {
      productName: string;
      productCategory?: string;
      rating?: number;
      description?: string;
      userInput?: string;
      spokenText?: string;
      uploadedPhotosCount?: number;
    },
  ) {
    return await this.aiService.generateProductSuggestions({
      productName: body.productName,
      productCategory: body.productCategory,
      rating: body.rating || 5,
      description: body.description,
      userInput: body.userInput,
      spokenText: body.spokenText,
      uploadedPhotosCount: body.uploadedPhotosCount,
    });
  }

  @Post('session/:token/overall-ai')
  async generateOverallAiPolish(
    @Param('token') token: string,
    @Body() body: GenerateOverallAiReviewDto,
  ) {
    return await this.aiService.polishOverallExperience({
      rawInput: body.rawInput,
      spokenText: body.spokenText,
      rating: body.rating || 5,
      productReviews: body.productReviews,
    });
  }

  @Post('session/:token/media')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMedia(
    @Param('token') token: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const session = await this.reviewsService.resolveSessionByToken(token);
    return await this.mediaService.saveUploadedFile({
      file,
      reviewSessionId: session.id || session.sessionId,
    });
  }

  @Post('session/:token/submit')
  async submitReview(
    @Param('token') token: string,
    @Body() dto: SubmitReviewDto,
  ) {
    return await this.reviewsService.submitReview(token, dto);
  }

  @Get('products/:productId')
  async getProductReviews(@Param('productId') productId: string) {
    return await this.reviewsService.getPublishedReviewsForProduct(productId);
  }

  @Get('qr/:token/image')
  async getQrImage(
    @Param('token') token: string,
    @Query('source') source: string,
    @Res() res: Response,
  ) {
    const buffer = await this.qrService.generateQrBuffer(token, source || 'invoice');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Disposition', `inline; filename="qr-${token}.png"`);
    res.send(buffer);
  }

  @Get('qr/:token/png')
  async getQrPng(
    @Param('token') token: string,
    @Query('source') source: string,
    @Res() res: Response,
  ) {
    return this.getQrImage(token, source, res);
  }

  @Get('qr/:token')
  async getQrCode(
    @Param('token') token: string,
    @Query('source') source: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    if (format === 'png' || format === 'image') {
      const buffer = await this.qrService.generateQrBuffer(token, source || 'invoice');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Disposition', `inline; filename="qr-${token}.png"`);
      return res.send(buffer);
    }

    const dataUrl = await this.qrService.generateQrDataUrl(token, source || 'invoice');
    const svg = await this.qrService.generateQrSvg(token, source || 'invoice');
    const cta = this.qrService.getInvoiceCtaText();
    return res.json({
      token,
      url: this.qrService.getReviewUrl(token, source || 'invoice'),
      dataUrl,
      svg,
      cta,
    });
  }
}

