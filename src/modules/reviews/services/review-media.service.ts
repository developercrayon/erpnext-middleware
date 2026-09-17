import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ReviewMedia } from '../../../database/entities/review-media.entity';
import { ReviewMediaType } from '../../../common/enums/review.enums';

@Injectable()
export class ReviewMediaService {
  private readonly logger = new Logger(ReviewMediaService.name);
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads', 'reviews');

  constructor(
    @InjectRepository(ReviewMedia)
    private readonly mediaRepo: Repository<ReviewMedia>,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async saveUploadedFile(params: {
    file: Express.Multer.File;
    reviewSessionId: string;
    reviewId?: string;
  }): Promise<ReviewMedia> {
    const { file, reviewSessionId, reviewId } = params;

    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Determine type
    let type: ReviewMediaType = ReviewMediaType.IMAGE;
    if (file.mimetype.startsWith('video/')) {
      type = ReviewMediaType.VIDEO;
    } else if (file.mimetype.startsWith('audio/')) {
      type = ReviewMediaType.VOICE;
    } else if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Unsupported media format. Please upload images, videos, or audio.');
    }

    // Validate size (Images: 10MB, Videos: 50MB, Audio: 20MB)
    const maxSize = type === ReviewMediaType.VIDEO ? 50 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(`File size exceeds limit (${maxSize / (1024 * 1024)}MB)`);
    }

    const ext = path.extname(file.originalname) || (type === ReviewMediaType.VOICE ? '.webm' : '.jpg');
    const fileName = `${uuidv4()}${ext}`;
    const destinationPath = path.join(this.uploadDir, fileName);

    fs.writeFileSync(destinationPath, file.buffer);
    const publicUrl = `/uploads/reviews/${fileName}`;

    const media = this.mediaRepo.create({
      review_session_id: reviewSessionId,
      review_id: reviewId || null,
      type,
      url: publicUrl,
      thumbnail_url: type === ReviewMediaType.IMAGE ? publicUrl : null,
      mime_type: file.mimetype,
      file_size: file.size,
      duration: null,
      transcript: null,
    });

    return await this.mediaRepo.save(media);
  }

  async attachMediaToReview(mediaIds: string[], reviewId: string): Promise<void> {
    if (!mediaIds || mediaIds.length === 0) return;
    await this.mediaRepo
      .createQueryBuilder()
      .update(ReviewMedia)
      .set({ review_id: reviewId })
      .whereInIds(mediaIds)
      .execute();
  }

  async getMediaByReviewId(reviewId: string): Promise<ReviewMedia[]> {
    return await this.mediaRepo.find({ where: { review_id: reviewId } });
  }
}
