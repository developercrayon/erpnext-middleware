import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { ReviewSession } from '../../../database/entities/review-session.entity';
import { Review } from '../../../database/entities/review.entity';
import { ReviewEvent } from '../../../database/entities/review-event.entity';
import { ReviewAiAnalysis } from '../../../database/entities/review-ai-analysis.entity';
import {
  ReviewSessionStatus,
  ReviewStatus,
  ReviewEventType,
} from '../../../common/enums/review.enums';
import {
  CreateReviewSessionDto,
} from '../dto/create-review-session.dto';
import { SubmitRatingDto } from '../dto/submit-rating.dto';
import { SubmitReviewDto } from '../dto/submit-review.dto';
import { TrackEventDto } from '../dto/track-event.dto';
import { ModerateReviewDto } from '../dto/moderate-review.dto';
import { ReviewAIService } from './review-ai.service';
import { ReviewMediaService } from './review-media.service';
import { ReviewSettingsService } from './review-settings.service';
import { ReviewQrService } from './review-qr.service';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectRepository(ReviewSession)
    private readonly sessionRepo: Repository<ReviewSession>,
    @InjectRepository(Review)
    private readonly reviewRepo: Repository<Review>,
    @InjectRepository(ReviewEvent)
    private readonly eventRepo: Repository<ReviewEvent>,
    @InjectRepository(ReviewAiAnalysis)
    private readonly analysisRepo: Repository<ReviewAiAnalysis>,
    private readonly aiService: ReviewAIService,
    private readonly mediaService: ReviewMediaService,
    private readonly settingsService: ReviewSettingsService,
    private readonly qrService: ReviewQrService,
    private readonly configService: ConfigService,
  ) {}

  generateSecureToken(): string {
    return crypto.randomBytes(16).toString('base64url');
  }

  async getOrCreateSession(dto: CreateReviewSessionDto): Promise<ReviewSession> {
    const existing = await this.sessionRepo.findOne({
      where: { order_id: dto.orderId, store_id: dto.storeId || 'woodwolff' },
      relations: ['reviews'],
    });

    if (existing) {
      return existing;
    }

    const token = this.generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90); // 90 days expiration

    const session = this.sessionRepo.create({
      token,
      store_id: dto.storeId || 'woodwolff',
      order_id: dto.orderId,
      customer_id: dto.customerId,
      customer_name: dto.customerName || null,
      customer_email: dto.customerEmail || null,
      customer_phone: dto.customerPhone || null,
      status: ReviewSessionStatus.PENDING,
      expires_at: expiresAt,
      order_metadata: { items: dto.items },
    });

    const saved = await this.sessionRepo.save(session);
    this.logger.log(`Created ReviewSession for order ${dto.orderId} with token: ${token}`);
    return saved;
  }

  async fetchErpSalesOrderDoc(orderId: string): Promise<any | null> {
    const url = this.configService.get<string>('ERPNEXT_BASE_URL', 'https://woodwolf.t3elements.com').replace(/\/+$/, '');
    const apiKey = this.configService.get<string>('ERPNEXT_API_KEY');
    const apiSecret = this.configService.get<string>('ERPNEXT_API_SECRET');

    if (!apiKey || !apiSecret) {
      return null;
    }

    try {
      const endpoint = `${url}/api/resource/Sales%20Order/${encodeURIComponent(orderId)}`;
      const res = await axios.get(endpoint, {
        headers: {
          Authorization: `token ${apiKey}:${apiSecret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 10000,
      });
      return res.data?.data || null;
    } catch (err: any) {
      this.logger.warn(`Failed to fetch ERPNext Sales Order ${orderId}: ${err.message}`);
      return null;
    }
  }

  async createOrderWithSession(dto: any): Promise<any> {
    let orderId = dto.orderId;
    let customerId = dto.customerId;
    let customerName = dto.customerName;
    let customerEmail = dto.customerEmail;
    let customerPhone = dto.customerPhone;
    let deliveryAddress = dto.deliveryAddress;
    let items = dto.items || [];

    // If orderId is provided and items is empty or an ERP order, fetch full live details from ERPNext
    if (orderId && (!items || items.length === 0 || orderId.startsWith('SAL-ORD-'))) {
      const erpData = await this.fetchErpSalesOrderDoc(orderId);
      if (erpData) {
        customerId = customerId || erpData.customer;
        customerName = customerName || erpData.customer_name || erpData.customer;
        customerEmail = customerEmail || erpData.contact_email || erpData.customer_email || '';
        customerPhone = customerPhone || erpData.contact_phone || erpData.contact_mobile || '';
        deliveryAddress = deliveryAddress || erpData.shipping_address || erpData.address_display || '';

        if (!items || items.length === 0) {
          items = (erpData.items || []).map((it: any) => ({
            orderItemId: it.name,
            productId: it.item_code,
            productName: it.item_name || it.item_code,
            productCategory: it.item_group || 'Products',
            productImageUrl: it.image || null,
            description: it.description || '',
            qty: it.qty || 1,
            rate: it.rate || it.amount || 0,
          }));
        }
      }
    }

    orderId = orderId || `WW-${Math.floor(10000 + Math.random() * 90000)}`;
    customerId = customerId || `CUST-${Math.floor(1000 + Math.random() * 9000)}`;

    const mappedItems = (items || []).map((item: any, idx: number) => ({
      orderItemId: item.orderItemId || `item-${orderId.toLowerCase()}-0${idx + 1}`,
      productId: item.productId || item.item_code,
      productName: item.productName || item.item_name || item.productId,
      productCategory: item.productCategory || item.item_group || 'Handcrafted Woodwork',
      productImageUrl: item.productImageUrl || item.image || null,
      description: item.description || '',
      qty: item.qty || 1,
      rate: item.rate || 0,
    }));

    const session = await this.getOrCreateSession({
      orderId,
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      items: mappedItems,
      storeId: 'woodwolff',
    });

    return {
      orderId,
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      deliveryAddress,
      items: mappedItems,
      session,
    };
  }

  async getErpSalesOrders(): Promise<any[]> {
    const url = this.configService.get<string>('ERPNEXT_BASE_URL', 'https://woodwolf.t3elements.com').replace(/\/+$/, '');
    const apiKey = this.configService.get<string>('ERPNEXT_API_KEY');
    const apiSecret = this.configService.get<string>('ERPNEXT_API_SECRET');
    const company = this.configService.get<string>('ERPNEXT_COMPANY', 'Woodwolf Studio (O) Pvt. Ltd');

    let erpOrders: any[] = [];

    if (apiKey && apiSecret) {
      try {
        const fields = JSON.stringify([
          'name',
          'customer',
          'customer_name',
          'transaction_date',
          'grand_total',
          'currency',
          'status',
          'docstatus',
          'delivery_status',
          'billing_status',
          'creation',
        ]);
        const filters = JSON.stringify([['company', '=', company]]);
        const endpoint = `${url}/api/resource/Sales%20Order?fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}&order_by=creation%20desc&limit_page_length=100`;

        const res = await axios.get(endpoint, {
          headers: {
            Authorization: `token ${apiKey}:${apiSecret}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 10000,
        });

        erpOrders = res.data?.data || [];
        this.logger.log(`Fetched ${erpOrders.length} live Sales Orders from ERPNext`);
      } catch (err: any) {
        this.logger.error(`Failed to fetch live Sales Orders from ERPNext: ${err.message}`);
      }
    }

    // Fetch existing review sessions from PostgreSQL to cross-reference tokens and reviews
    const existingSessions = await this.sessionRepo.find({
      relations: ['reviews'],
      order: { created_at: 'DESC' },
    });

    const sessionMap = new Map<string, ReviewSession>();
    for (const s of existingSessions) {
      if (s.order_id) {
        sessionMap.set(s.order_id, s);
      }
    }

    // Map live ERP orders
    const mappedErpOrders = erpOrders.map((order) => {
      const session = sessionMap.get(order.name);
      const items = session?.order_metadata?.items || [];
      const isReviewed =
        session?.reviews &&
        session.reviews.length > 0 &&
        session.reviews.some((r) => r.status !== ReviewStatus.REJECTED);

      return {
        orderId: order.name,
        customerId: order.customer,
        customerName: order.customer_name || order.customer,
        customerEmail: session?.customer_email || '',
        customerPhone: session?.customer_phone || '',
        date: order.transaction_date || order.creation,
        status: order.status || (order.docstatus === 1 ? 'Submitted' : 'Draft'),
        deliveryStatus: order.delivery_status || 'Not Delivered',
        billingStatus: order.billing_status || 'Not Billed',
        currency: order.currency || 'INR',
        grandTotal: order.grand_total,
        totalItems: items.length,
        items,
        token: session ? session.token : null,
        reviewUrl: session ? this.qrService.getReviewUrl(session.token, 'DIRECT') : null,
        qrReviewUrl: session ? this.qrService.getReviewUrl(session.token, 'INVOICE') : null,
        whatsappReviewUrl: session ? this.qrService.getReviewUrl(session.token, 'WHATSAPP') : null,
        emailReviewUrl: session ? this.qrService.getReviewUrl(session.token, 'EMAIL') : null,
        isReviewed: !!isReviewed,
        reviewCount: session?.reviews ? session.reviews.length : 0,
      };
    });

    // Also include any sessions created directly that might not be in ERPNext
    const sessionOnlyOrders = existingSessions
      .filter((s) => !erpOrders.some((e) => e.name === s.order_id))
      .map((s) => {
        const items = s.order_metadata?.items || [];
        const isReviewed =
          s.reviews &&
          s.reviews.length > 0 &&
          s.reviews.some((r) => r.status !== ReviewStatus.REJECTED);

        return {
          orderId: s.order_id,
          customerId: s.customer_id,
          customerName: s.customer_name || 'Customer',
          customerEmail: s.customer_email || '',
          customerPhone: s.customer_phone || '',
          date: s.created_at,
          status: s.status,
          deliveryStatus: 'Custom',
          billingStatus: 'Custom',
          currency: 'INR',
          grandTotal: items.reduce((sum: number, it: any) => sum + (it.rate || 0) * (it.qty || 1), 0),
          totalItems: items.length,
          items,
          token: s.token,
          reviewUrl: this.qrService.getReviewUrl(s.token, 'DIRECT'),
          qrReviewUrl: this.qrService.getReviewUrl(s.token, 'INVOICE'),
          whatsappReviewUrl: this.qrService.getReviewUrl(s.token, 'WHATSAPP'),
          emailReviewUrl: this.qrService.getReviewUrl(s.token, 'EMAIL'),
          isReviewed: !!isReviewed,
          reviewCount: s.reviews ? s.reviews.length : 0,
        };
      });

    return [...mappedErpOrders, ...sessionOnlyOrders];
  }

  async resolveSessionByToken(token: string, source: string = 'DIRECT'): Promise<any> {
    const session = await this.sessionRepo.findOne({
      where: { token },
      relations: ['reviews', 'reviews.media'],
    });

    if (!session) {
      throw new NotFoundException('Sorry, this review link is no longer valid or has expired.');
    }

    if (session.expires_at && new Date() > new Date(session.expires_at)) {
      session.status = ReviewSessionStatus.EXPIRED;
      await this.sessionRepo.save(session);
      throw new BadRequestException('This review link has expired.');
    }

    // Update session open timestamps & status
    const now = new Date();
    if (!session.first_opened_at) {
      session.first_opened_at = now;
    }
    session.last_opened_at = now;
    if (session.status === ReviewSessionStatus.PENDING) {
      session.status = ReviewSessionStatus.STARTED;
    }
    await this.sessionRepo.save(session);

    // Record source-specific open event
    let eventType = ReviewEventType.PAGE_OPENED;
    if (source.toUpperCase() === 'INVOICE') eventType = ReviewEventType.QR_SCANNED;
    if (source.toUpperCase() === 'EMAIL') eventType = ReviewEventType.EMAIL_CLICKED;
    if (source.toUpperCase() === 'WHATSAPP') eventType = ReviewEventType.WHATSAPP_CLICKED;

    await this.recordEvent(session.id, eventType, source);

    // Sanitize order items and correlate with existing reviews
    const items = (session.order_metadata?.items || []).map((item: any) => {
      const existingReview = (session.reviews || []).find(
        (r) =>
          (r.order_item_id && item.orderItemId && r.order_item_id === item.orderItemId) ||
          (r.product_id && item.productId && r.product_id === item.productId) ||
          (r.order_item_id && item.productId && r.order_item_id === item.productId),
      );
      return {
        orderItemId: item.orderItemId,
        productId: item.productId,
        productName: item.productName,
        productImageUrl: item.productImageUrl || null,
        productCategory: item.productCategory || 'Woodwork',
        description: item.description || null,
        isReviewed: !!existingReview && existingReview.status !== ReviewStatus.REJECTED,
        review: existingReview
          ? {
              id: existingReview.id,
              rating: existingReview.rating,
              title: existingReview.title,
              content: existingReview.content,
              originalContent: existingReview.original_content,
              status: existingReview.status,
              aiGenerated: existingReview.ai_generated,
              aiEditedByCustomer: existingReview.ai_edited_by_customer,
              media: (existingReview.media || []).map((m) => ({
                id: m.id,
                url: m.url,
                type: m.type,
                name: m.url ? m.url.split('/').pop() : 'Photo',
              })),
            }
          : null,
      };
    });

    return {
      id: session.id,
      sessionId: session.id,
      sessionToken: session.token,
      storeId: session.store_id,
      orderId: session.order_id,
      customerName: session.customer_name,
      status: session.status,
      overallFeedback: session.order_metadata?.overallFeedback || '',
      items,
      completed: items.length > 0 && items.every((i: any) => i.isReviewed),
    };
  }

  async recordEvent(
    sessionId: string,
    event: string,
    source: string = 'DIRECT',
    metadata?: any,
  ): Promise<ReviewEvent> {
    const revEvent = this.eventRepo.create({
      review_session_id: sessionId,
      event,
      source: source.toUpperCase(),
      metadata: metadata || null,
    });
    return await this.eventRepo.save(revEvent);
  }

  async trackEventByToken(token: string, dto: TrackEventDto): Promise<{ success: boolean }> {
    const session = await this.sessionRepo.findOne({ where: { token } });
    if (!session) throw new NotFoundException('Review session not found');
    await this.recordEvent(session.id, dto.event, dto.source || 'DIRECT', dto.metadata);
    return { success: true };
  }

  async saveDraftRating(token: string, dto: SubmitRatingDto): Promise<{ success: boolean }> {
    const session = await this.sessionRepo.findOne({ where: { token } });
    if (!session) throw new NotFoundException('Session not found');

    const items = session.order_metadata?.items || [];
    const item =
      items.find(
        (i: any) =>
          (dto.orderItemId && (i.orderItemId === dto.orderItemId || i.productId === dto.orderItemId)) ||
          (dto.productId && (i.productId === dto.productId || i.orderItemId === dto.productId)),
      ) || items[0];

    if (!item) {
      throw new BadRequestException('Order item does not belong to this review session.');
    }

    const orderItemId = item.orderItemId || dto.orderItemId;

    let review = await this.reviewRepo.findOne({
      where: [
        { review_session_id: session.id, order_item_id: orderItemId },
        { customer_id: session.customer_id, order_item_id: orderItemId },
      ],
    });

    if (!review) {
      review = this.reviewRepo.create({
        review_session_id: session.id,
        store_id: session.store_id,
        order_id: session.order_id,
        order_item_id: orderItemId,
        customer_id: session.customer_id,
        customer_name: session.customer_name,
        product_id: item.productId,
        product_name: item.productName,
        product_image_url: item.productImageUrl || null,
        rating: dto.rating,
        status: ReviewStatus.PENDING_MODERATION,
        verified_purchase: true,
        source: dto.source || 'DIRECT',
      });
    } else {
      review.review_session_id = session.id;
      review.rating = dto.rating;
    }

    await this.reviewRepo.save(review);
    await this.recordEvent(session.id, ReviewEventType.RATING_SELECTED, dto.source || 'DIRECT', {
      orderItemId,
      rating: dto.rating,
    });

    return { success: true };
  }

  async submitReview(token: string, dto: SubmitReviewDto): Promise<Review> {
    try {
      const session = await this.sessionRepo.findOne({
        where: { token },
      });
      if (!session) throw new NotFoundException('Session not found');

      const items = session.order_metadata?.items || [];
      const item =
        items.find(
          (i: any) =>
            (dto.orderItemId && (i.orderItemId === dto.orderItemId || i.productId === dto.orderItemId)) ||
            (dto.productId && (i.productId === dto.productId || i.orderItemId === dto.productId)),
        ) || items[0];

      if (!item) {
        throw new BadRequestException('Order item does not belong to this order.');
      }

      const orderItemId = item.orderItemId || dto.orderItemId;

      let review = await this.reviewRepo.findOne({
        where: [
          { review_session_id: session.id, order_item_id: orderItemId },
          { customer_id: session.customer_id, order_item_id: orderItemId },
          { review_session_id: session.id, product_id: item.productId },
        ],
      });

      const settings = this.settingsService.getSettings();
      const autoPublishMin = settings.autoPublishMinRating ?? 3.5;
      const isAutoPublish = settings.autoPublishEnabled !== false && dto.rating >= autoPublishMin;
      const initialStatus = isAutoPublish ? ReviewStatus.PUBLISHED : ReviewStatus.PENDING_MODERATION;

      const now = new Date();
      if (!review) {
        review = this.reviewRepo.create({
          review_session_id: session.id,
          store_id: session.store_id,
          order_id: session.order_id,
          order_item_id: orderItemId,
          customer_id: session.customer_id,
          customer_name: session.customer_name,
          product_id: item.productId,
          product_name: item.productName,
          product_image_url: item.productImageUrl || null,
          rating: dto.rating,
          title: dto.title || null,
          content: dto.content,
          original_content: dto.originalContent || dto.content,
          status: initialStatus,
          approved_at: isAutoPublish ? now : null,
          published_at: isAutoPublish ? now : null,
          verified_purchase: true,
          ai_generated: dto.aiGenerated || false,
          ai_edited_by_customer: dto.aiEditedByCustomer || false,
          submitted_at: now,
          source: dto.source || 'DIRECT',
        });
      } else {
        review.review_session_id = session.id;
        review.rating = dto.rating;
        review.title = dto.title || review.title;
        review.content = dto.content;
        review.original_content = dto.originalContent || review.original_content;
        review.ai_generated = dto.aiGenerated ?? review.ai_generated;
        review.ai_edited_by_customer = dto.aiEditedByCustomer ?? review.ai_edited_by_customer;
        review.submitted_at = now;
        review.status = initialStatus;
        if (isAutoPublish) {
          review.approved_at = review.approved_at || now;
          review.published_at = now;
        }
      }

      const savedReview = await this.reviewRepo.save(review);

      // Attach uploaded media if provided
      if (dto.mediaIds && dto.mediaIds.length > 0) {
        await this.mediaService.attachMediaToReview(dto.mediaIds, savedReview.id);
      }

      // Check if all items in session are completed
      const allReviews = await this.reviewRepo.find({ where: { review_session_id: session.id } });
      const isComplete = items.length > 0 && allReviews.length >= items.length;

      const updatedMetadata = {
        ...(session.order_metadata || {}),
        ...(dto.overallFeedback !== undefined ? { overallFeedback: dto.overallFeedback } : {}),
      };

      await this.sessionRepo.update(session.id, {
        order_metadata: updatedMetadata,
        ...(isComplete ? { status: ReviewSessionStatus.SUBMITTED, completed_at: now } : {}),
      });

      // If auto-published, trigger ERPNext synchronization
      if (isAutoPublish) {
        this.pushReviewToErpNext(savedReview).catch((err) => {
          this.logger.warn(`ERPNext review sync error on auto-publish: ${err.message}`);
        });
      }

      await this.recordEvent(session.id, ReviewEventType.REVIEW_SUBMITTED, dto.source || 'DIRECT', {
        reviewId: savedReview.id,
        rating: savedReview.rating,
        autoPublished: isAutoPublish,
      });

    // Trigger asynchronous AI analysis without blocking customer response
    this.runAsyncAiAnalysis(savedReview.id, savedReview.content, savedReview.rating, item.productName).catch((err) => {
      this.logger.warn(`Async AI analysis error: ${err.message}`);
    });

      return savedReview;
    } catch (err: any) {
      this.logger.error(`Error in submitReview: ${err.message}`, err.stack);
      throw err;
    }
  }

  private async runAsyncAiAnalysis(
    reviewId: string,
    content: string,
    rating: number,
    productName: string,
  ): Promise<void> {
    try {
      const analysis = await this.aiService.analyzeSubmittedReview(content, rating, productName);
      const entity = this.analysisRepo.create({
        review_id: reviewId,
        sentiment: analysis.sentiment,
        topics: analysis.topics,
        keywords: analysis.keywords,
        summary: analysis.summary,
        aspect_ratings: analysis.aspectRatings,
      });
      await this.analysisRepo.save(entity);
      this.logger.log(`AI Analysis completed for review ${reviewId}`);
    } catch (e) {
      this.logger.error(`Failed AI Analysis for review ${reviewId}: ${e.message}`);
    }
  }

  async getAllReviewsForAdmin(query: {
    status?: string;
    rating?: number;
    source?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'ASC' | 'DESC';
    hasMedia?: boolean;
    aiGenerated?: boolean;
  }): Promise<{ items: Review[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const qb = this.reviewRepo
      .createQueryBuilder('review')
      .leftJoinAndSelect('review.session', 'session')
      .leftJoinAndSelect('review.media', 'media')
      .leftJoinAndSelect('review.ai_analysis', 'ai_analysis');

    if (query.status && query.status !== 'ALL') {
      qb.andWhere('review.status = :status', { status: query.status });
    }
    if (query.rating) {
      qb.andWhere('review.rating = :rating', { rating: Number(query.rating) });
    }
    if (query.source && query.source !== 'ALL') {
      qb.andWhere('review.source = :source', { source: query.source });
    }
    if (query.hasMedia) {
      qb.andWhere('media.id IS NOT NULL');
    }
    if (query.aiGenerated !== undefined) {
      qb.andWhere('review.ai_generated = :aiGen', { aiGen: query.aiGenerated });
    }
    if (query.search && query.search.trim()) {
      const cleanSearch = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(COALESCE(review.product_name, \'\')) LIKE :search OR LOWER(COALESCE(review.customer_name, \'\')) LIKE :search OR LOWER(COALESCE(session.customer_name, \'\')) LIKE :search OR LOWER(COALESCE(session.customer_email, \'\')) LIKE :search OR LOWER(COALESCE(review.order_id, \'\')) LIKE :search OR LOWER(COALESCE(review.content, \'\')) LIKE :search OR LOWER(COALESCE(review.title, \'\')) LIKE :search OR LOWER(COALESCE(review.customer_id, \'\')) LIKE :search OR LOWER(COALESCE(review.source, \'\')) LIKE :search)',
        { search: cleanSearch },
      );
    }

    const sortField = query.sortBy === 'rating' ? 'review.rating' :
                      query.sortBy === 'product_name' ? 'review.product_name' :
                      query.sortBy === 'customer_name' ? 'review.customer_name' :
                      'review.created_at';
    const sortDirection = query.sortOrder === 'ASC' ? 'ASC' : 'DESC';
    qb.orderBy(sortField, sortDirection);

    qb.skip(skip).take(limit);

    const [items, total] = await qb.getManyAndCount();
    const totalPages = Math.ceil(total / limit) || 1;
    return { items, total, page, limit, totalPages };
  }

  async getAllOrderReviewsForAdmin(query: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: any[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const qb = this.sessionRepo
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.reviews', 'reviews')
      .leftJoinAndSelect('reviews.media', 'media')
      .leftJoinAndSelect('reviews.ai_analysis', 'ai_analysis');

    if (query.status && query.status !== 'ALL') {
      qb.andWhere('session.status = :status', { status: query.status });
    }

    if (query.search && query.search.trim()) {
      const cleanSearch = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(COALESCE(session.order_id, \'\')) LIKE :search OR LOWER(COALESCE(session.customer_name, \'\')) LIKE :search OR LOWER(COALESCE(session.customer_email, \'\')) LIKE :search OR LOWER(COALESCE(session.customer_phone, \'\')) LIKE :search)',
        { search: cleanSearch },
      );
    }

    qb.orderBy('session.created_at', 'DESC');
    qb.skip(skip).take(limit);

    const [sessions, total] = await qb.getManyAndCount();

    const items = sessions.map((s) => {
      const revs = s.reviews || [];
      const avgRating =
        revs.length > 0
          ? Number((revs.reduce((acc, r) => acc + (Number(r.rating) || 0), 0) / revs.length).toFixed(1))
          : null;
      const orderItems = s.order_metadata?.items || [];
      const overallFeedback = s.order_metadata?.overallFeedback || '';
      const source = revs[0]?.source || 'DIRECT';

      return {
        id: s.id,
        orderId: s.order_id,
        customerId: s.customer_id,
        customerName: s.customer_name || 'Customer',
        customerEmail: s.customer_email,
        customerPhone: s.customer_phone,
        status: s.status,
        averageRating: avgRating,
        reviewsCount: revs.length,
        totalItemsCount: orderItems.length || revs.length,
        overallFeedback,
        orderItems,
        reviews: revs,
        token: s.token,
        createdAt: s.created_at,
        completedAt: s.completed_at,
        source,
      };
    });

    const totalPages = Math.ceil(total / limit) || 1;
    return { items, total, page, limit, totalPages };
  }

  async getReviewDetailForAdmin(id: string): Promise<any> {
    const review = await this.reviewRepo.findOne({
      where: { id },
      relations: ['session', 'media', 'ai_analysis'],
    });
    if (!review) throw new NotFoundException('Review not found');

    const events = await this.eventRepo.find({
      where: { review_session_id: review.review_session_id },
      order: { created_at: 'ASC' },
    });

    return {
      ...review,
      timelineEvents: events,
    };
  }

  async moderateReview(id: string, dto: ModerateReviewDto): Promise<Review> {
    const review = await this.reviewRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');

    review.status = dto.status;
    const now = new Date();
    if (dto.status === ReviewStatus.APPROVED) {
      review.approved_at = now;
    } else if (dto.status === ReviewStatus.PUBLISHED) {
      review.approved_at = review.approved_at || now;
      review.published_at = now;
    }

    const saved = await this.reviewRepo.save(review);
    const eventType =
      dto.status === ReviewStatus.APPROVED
        ? ReviewEventType.REVIEW_APPROVED
        : dto.status === ReviewStatus.PUBLISHED
        ? ReviewEventType.REVIEW_PUBLISHED
        : ReviewEventType.REVIEW_REJECTED;

    await this.recordEvent(review.review_session_id, eventType, 'ADMIN', {
      reviewId: review.id,
      notes: dto.moderationNotes,
    });

    this.pushReviewToErpNext(saved).catch((err) => {
      this.logger.warn(`Failed to push moderated review #${saved.id} to ERPNext: ${err.message}`);
    });

    return saved;
  }

  async batchModerateReviews(
    ids: string[],
    action: 'approve' | 'publish' | 'reject' | 'delete',
  ): Promise<{ affected: number }> {
    if (!ids || ids.length === 0) return { affected: 0 };

    if (action === 'delete') {
      const result = await this.reviewRepo
        .createQueryBuilder()
        .delete()
        .from(Review)
        .whereInIds(ids)
        .execute();
      return { affected: result.affected || 0 };
    }

    const targetStatus =
      action === 'approve'
        ? ReviewStatus.APPROVED
        : action === 'publish'
        ? ReviewStatus.PUBLISHED
        : ReviewStatus.REJECTED;

    const now = new Date();
    const reviews = await this.reviewRepo.findByIds(ids);
    for (const r of reviews) {
      r.status = targetStatus;
      if (targetStatus === ReviewStatus.APPROVED) {
        r.approved_at = now;
      } else if (targetStatus === ReviewStatus.PUBLISHED) {
        r.approved_at = r.approved_at || now;
        r.published_at = now;
      }
      const saved = await this.reviewRepo.save(r);
      await this.recordEvent(
        r.review_session_id,
        targetStatus === ReviewStatus.APPROVED
          ? ReviewEventType.REVIEW_APPROVED
          : targetStatus === ReviewStatus.PUBLISHED
          ? ReviewEventType.REVIEW_PUBLISHED
          : ReviewEventType.REVIEW_REJECTED,
        'ADMIN',
        { reviewId: r.id, batch: true },
      );

      this.pushReviewToErpNext(saved).catch((err) => {
        this.logger.warn(`ERPNext batch review sync error: ${err.message}`);
      });
    }
    return { affected: reviews.length };
  }

  async pushReviewToErpNext(review: Review): Promise<boolean> {
    const url = this.configService.get<string>('ERPNEXT_BASE_URL', 'https://woodwolf.t3elements.com').replace(/\/+$/, '');
    const apiKey = this.configService.get<string>('ERPNEXT_API_KEY');
    const apiSecret = this.configService.get<string>('ERPNEXT_API_SECRET');

    if (!apiKey || !apiSecret || apiKey === 'your_erpnext_api_key_here') {
      this.logger.log(`ERPNext credentials placeholder detected. Simulated review push for Review #${review.id}`);
      return true;
    }

    try {
      const headers = {
        Authorization: `token ${apiKey}:${apiSecret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      // Resolve session metadata for customer name & overall order feedback
      let session = review.session;
      if (!session && review.review_session_id) {
        session = await this.sessionRepo.findOne({ where: { id: review.review_session_id } });
      }
      const customerName = session?.customer_name || review.customer_name || 'Customer';
      const overallFeedback = session?.order_metadata?.overallFeedback || '';

      // Map local status to ERPNext status ('approved' | 'rejected' | 'pending')
      const erpStatus =
        review.status === ReviewStatus.PUBLISHED || review.status === ReviewStatus.APPROVED
          ? 'approved'
          : review.status === ReviewStatus.REJECTED
          ? 'rejected'
          : 'pending';

      // Clean order ID (strip leading #)
      const cleanOrderId = (review.order_id || '').replace(/^#/, '').trim();

      // Collect all item reviews for this order/session to populate Sale Ratings table & calculate order average rating
      let orderReviews: Review[] = [];
      if (review.review_session_id) {
        orderReviews = await this.reviewRepo.find({
          where: { review_session_id: review.review_session_id },
        });
      } else if (cleanOrderId) {
        orderReviews = await this.reviewRepo.find({
          where: { order_id: review.order_id },
        });
      }
      if (orderReviews.length === 0) {
        orderReviews = [review];
      }

      // Calculate order average rating across items
      const totalRating = orderReviews.reduce((sum, r) => sum + (Number(r.rating) || 5), 0);
      const avgOrderRating = orderReviews.length > 0
        ? parseFloat((totalRating / orderReviews.length).toFixed(2))
        : Number(review.rating) || 5;

      // Build child table rows for DocType: "Sale Ratings"
      // item: Item Code in ERPNext
      // rating: Rating given for this product in this order
      const ratingsRows = orderReviews
        .filter((r) => !!r.product_id)
        .map((r) => ({
          item: r.product_id.trim(),
          rating: Number(r.rating) || 5,
        }));

      // Overall review text for the review field (Text Editor in ERPNext)
      const reviewText = overallFeedback || review.content || 'Customer Review';
      const reviewHtml = reviewText.startsWith('<p>') ? reviewText : `<p>${reviewText}</p>`;

      // 1. Sync to ERPNext DocType: "Review Rating" (with Sale Ratings child table)
      try {
        const reviewRatingPayload: any = {
          user: customerName || review.customer_id || undefined,
          status: erpStatus,
          review: reviewHtml,
          order: cleanOrderId || undefined,
          ratings: ratingsRows,
        };

        // Check if an existing Review Rating doc exists for this order
        let existingDocName: string | null = null;
        if (cleanOrderId) {
          try {
            const queryUrl = `${url}/api/resource/Review%20Rating?filters=[["order","=","${cleanOrderId}"]]&fields=["name"]`;
            const checkRes = await axios.get(queryUrl, { headers, timeout: 5000 });
            if (checkRes.data?.data && checkRes.data.data.length > 0) {
              existingDocName = checkRes.data.data[0].name;
            }
          } catch (checkErr: any) {
            this.logger.debug(`Existing Review Rating check notice: ${checkErr.message}`);
          }
        }

        let reviewRatingRes;
        if (existingDocName) {
          // Update existing doc
          try {
            reviewRatingRes = await axios.put(
              `${url}/api/resource/Review%20Rating/${encodeURIComponent(existingDocName)}`,
              reviewRatingPayload,
              { headers, timeout: 8000 },
            );
          } catch (putErr: any) {
            // If link validation fails on user, retry without user field
            if (reviewRatingPayload.user) {
              const retryPayload = { ...reviewRatingPayload };
              delete retryPayload.user;
              reviewRatingRes = await axios.put(
                `${url}/api/resource/Review%20Rating/${encodeURIComponent(existingDocName)}`,
                retryPayload,
                { headers, timeout: 8000 },
              );
            } else {
              throw putErr;
            }
          }
          this.logger.log(
            `Successfully updated ERPNext "Review Rating" ${existingDocName} for order ${cleanOrderId}`,
          );
        } else {
          // Create new doc
          try {
            reviewRatingRes = await axios.post(
              `${url}/api/resource/Review%20Rating`,
              reviewRatingPayload,
              { headers, timeout: 8000 },
            );
          } catch (postErr: any) {
            // If link validation fails on user, retry without user field
            if (reviewRatingPayload.user) {
              const retryPayload = { ...reviewRatingPayload };
              delete retryPayload.user;
              reviewRatingRes = await axios.post(
                `${url}/api/resource/Review%20Rating`,
                retryPayload,
                { headers, timeout: 8000 },
              );
            } else {
              throw postErr;
            }
          }
          this.logger.log(
            `Successfully created ERPNext "Review Rating" record with status: "${erpStatus}" (Doc: ${reviewRatingRes?.data?.data?.name})`,
          );
        }
      } catch (reviewRatingErr: any) {
        this.logger.warn(
          `ERPNext "Review Rating" sync notice: ${reviewRatingErr.response?.data?.message || reviewRatingErr.message}`,
        );
      }

      return true;
    } catch (e: any) {
      this.logger.error(`Error pushing review #${review.id} to ERPNext: ${e.message}`);
      return false;
    }
  }

  private buildReviewHtml(review: Review, customerName: string, overallFeedback: string): string {
    const reviewText = overallFeedback || review.content || 'Customer Review';
    return reviewText.startsWith('<p>') ? reviewText : `<p>${reviewText}</p>`;
  }

  async updateReviewAdmin(
    id: string,
    dto: { title?: string; content?: string; rating?: number; status?: ReviewStatus },
  ): Promise<Review> {
    const review = await this.reviewRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');

    if (dto.title !== undefined) review.title = dto.title;
    if (dto.content !== undefined) review.content = dto.content;
    if (dto.rating !== undefined) review.rating = dto.rating;
    if (dto.status !== undefined) review.status = dto.status;

    const saved = await this.reviewRepo.save(review);
    this.pushReviewToErpNext(saved).catch((err) => {
      this.logger.warn(`ERPNext review sync error on admin edit: ${err.message}`);
    });
    return saved;
  }

  async deleteReviewAdmin(id: string): Promise<{ success: boolean }> {
    const review = await this.reviewRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    await this.reviewRepo.remove(review);
    return { success: true };
  }

  async deleteOrderReviewSessionAdmin(sessionId: string): Promise<{ success: boolean }> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: ['reviews'],
    });
    if (!session) throw new NotFoundException('Order review session not found');

    // Remove child events
    await this.eventRepo.delete({ review_session_id: session.id });

    // Remove child reviews
    if (session.reviews && session.reviews.length > 0) {
      await this.reviewRepo.remove(session.reviews);
    }

    await this.sessionRepo.remove(session);
    return { success: true };
  }

  async reAnalyzeReview(id: string): Promise<ReviewAiAnalysis | null> {
    const review = await this.reviewRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');

    // Remove existing analysis if present
    await this.analysisRepo.delete({ review_id: id });

    // Run AI analysis
    const analysis = await this.aiService.analyzeSubmittedReview(
      review.content || review.original_content || '',
      review.rating,
      review.product_name || 'Artisan Product',
    );

    const entity = this.analysisRepo.create({
      review_id: review.id,
      sentiment: analysis.sentiment,
      topics: analysis.topics,
      keywords: analysis.keywords,
      summary: analysis.summary,
      aspect_ratings: analysis.aspectRatings,
    });

    return await this.analysisRepo.save(entity);
  }

  async getReviewsForOrder(orderId: string): Promise<Review[]> {
    return await this.reviewRepo.find({
      where: { order_id: orderId },
      relations: ['media', 'ai_analysis'],
      order: { created_at: 'ASC' },
    });
  }

  async getPublishedReviewsForProduct(productId: string): Promise<{
    reviews: Review[];
    averageRating: number;
    totalReviews: number;
    ratingBreakdown: Record<number, number>;
  }> {
    const reviews = await this.reviewRepo.find({
      where: { product_id: productId, status: ReviewStatus.PUBLISHED },
      relations: ['media'],
      order: { created_at: 'DESC' },
    });

    const totalReviews = reviews.length;
    const breakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;

    for (const r of reviews) {
      breakdown[r.rating] = (breakdown[r.rating] || 0) + 1;
      sum += r.rating;
    }

    const averageRating = totalReviews > 0 ? Number((sum / totalReviews).toFixed(1)) : 0;
    return {
      reviews,
      averageRating,
      totalReviews,
      ratingBreakdown: breakdown,
    };
  }

  async getAnalyticsSummary(): Promise<any> {
    const totalSessions = await this.sessionRepo.count();
    const totalReviews = await this.reviewRepo.count();
    const pendingModeration = await this.reviewRepo.count({
      where: { status: ReviewStatus.PENDING_MODERATION },
    });
    const approvedReviews = await this.reviewRepo.count({
      where: { status: ReviewStatus.APPROVED },
    });
    const publishedReviews = await this.reviewRepo.count({
      where: { status: ReviewStatus.PUBLISHED },
    });
    const rejectedReviews = await this.reviewRepo.count({
      where: { status: ReviewStatus.REJECTED },
    });

    const qrScans = await this.eventRepo.count({ where: { event: ReviewEventType.QR_SCANNED } });
    const emailClicks = await this.eventRepo.count({ where: { event: ReviewEventType.EMAIL_CLICKED } });
    const whatsappClicks = await this.eventRepo.count({ where: { event: ReviewEventType.WHATSAPP_CLICKED } });
    const googleClicks = await this.eventRepo.count({ where: { event: ReviewEventType.GOOGLE_CLICKED } });
    const ratingsStarted = await this.eventRepo.count({ where: { event: ReviewEventType.RATING_SELECTED } });
    const aiPolishedCount = await this.reviewRepo.count({ where: { ai_generated: true } });

    // Calculate rating averages & distribution
    const allRatings = await this.reviewRepo
      .createQueryBuilder('review')
      .select('AVG(review.rating)', 'avgRating')
      .getRawOne();

    const ratingBreakdown: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (let r = 1; r <= 5; r++) {
      ratingBreakdown[r] = await this.reviewRepo.count({ where: { rating: r } });
    }

    // Sentiment breakdown
    const positiveSentiment = await this.analysisRepo.count({ where: { sentiment: 'positive' } });
    const neutralSentiment = await this.analysisRepo.count({ where: { sentiment: 'neutral' } });
    const negativeSentiment = await this.analysisRepo.count({ where: { sentiment: 'negative' } });

    // Channel sources counts from reviews
    const invoiceSource = await this.reviewRepo.count({ where: { source: 'INVOICE' } });
    const emailSource = await this.reviewRepo.count({ where: { source: 'EMAIL' } });
    const whatsappSource = await this.reviewRepo.count({ where: { source: 'WHATSAPP' } });
    const directSource = await this.reviewRepo.count({ where: { source: 'DIRECT' } });

    return {
      totalSessions,
      totalReviews,
      pendingModeration,
      approvedReviews,
      publishedReviews,
      rejectedReviews,
      aiPolishedCount,
      averageRating: allRatings?.avgRating ? Number(Number(allRatings.avgRating).toFixed(2)) : 5.0,
      ratingBreakdown,
      sentimentBreakdown: {
        positive: positiveSentiment,
        neutral: neutralSentiment,
        negative: negativeSentiment,
      },
      funnel: {
        totalSessionsGenerated: totalSessions,
        totalEngagements: qrScans + emailClicks + whatsappClicks,
        qrScans,
        emailClicks,
        whatsappClicks,
        ratingsStarted,
        reviewsSubmitted: totalReviews,
        googleReviewClicks: googleClicks,
      },
      sources: {
        invoice: qrScans || invoiceSource,
        email: emailClicks || emailSource,
        whatsapp: whatsappClicks || whatsappSource,
        direct: directSource,
      },
      sourceReviewCounts: {
        invoice: invoiceSource,
        email: emailSource,
        whatsapp: whatsappSource,
        direct: directSource,
      },
    };
  }
}
