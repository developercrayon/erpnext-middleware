import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { InstagramService } from './instagram.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialPost, SocialPostStatus } from '../../database/entities/social-post.entity';

@Processor(QUEUE_NAMES.SOCIAL_POSTS)
export class SocialPostsPublisherProcessor {
  private readonly logger = new Logger(SocialPostsPublisherProcessor.name);

  constructor(
    private readonly instagramService: InstagramService,
    @InjectRepository(SocialPost)
    private readonly postRepo: Repository<SocialPost>,
  ) {}

  @Process(JOB_NAMES.PUBLISH_SOCIAL_POST)
  async handlePublishJob(job: Job<{ postId: string }>) {
    const { postId } = job.data;
    this.logger.log(`Processing publish job for post: ${postId}`);

    const post = await this.postRepo.findOne({ where: { id: postId } });

    if (!post) {
      this.logger.error(`Post not found: ${postId}`);
      throw new Error('Post not found');
    }

    if (post.status === SocialPostStatus.PUBLISHED) {
      this.logger.log(`Post ${postId} is already published. Skipping.`);
      return;
    }

    try {
      // Mark as publishing
      post.status = SocialPostStatus.PUBLISHING;
      await this.postRepo.save(post);

      // Verify media exists
      if (!post.mediaUrls || post.mediaUrls.length === 0) {
        throw new Error('No media URLs available to publish');
      }

      // Build public URL for the image
      // Instagram requires a publicly accessible URL to download the image.
      const publicBaseUrl = process.env.APP_PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000';
      const firstImageUrl = post.mediaUrls[0];
      const fullImageUrl = firstImageUrl.startsWith('http') 
        ? firstImageUrl 
        : `${publicBaseUrl}${firstImageUrl.startsWith('/') ? '' : '/'}${firstImageUrl}`;

      // 1. Create Media Container
      const caption = post.caption || '';
      const creationId = await this.instagramService.createMediaContainer(fullImageUrl, caption);

      // 2. Publish Media
      const igPostId = await this.instagramService.publishMedia(creationId);

      // 3. Update DB
      post.status = SocialPostStatus.PUBLISHED;
      // You can store the igPostId in a new column if added, otherwise just log it
      post.errorMessage = null;
      await this.postRepo.save(post);

      this.logger.log(`Successfully published post ${postId} to Instagram!`);

    } catch (error: any) {
      this.logger.error(`Failed to publish post ${postId}: ${error.message}`);
      
      // Update DB with failure
      post.status = SocialPostStatus.FAILED;
      post.errorMessage = error.message;
      await this.postRepo.save(post);
      
      throw error; // Let Bull retry it based on QUEUE_DEFAULT_OPTIONS
    }
  }
}
