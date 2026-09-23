import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { InstagramService } from './instagram.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialPost, SocialPostStatus } from '../../database/entities/social-post.entity';
import { AiSettingsService } from '../ai/services/ai-settings.service';

import { PinterestService } from './pinterest.service';

@Processor(QUEUE_NAMES.SOCIAL_POSTS)
export class SocialPostsPublisherProcessor {
  private readonly logger = new Logger(SocialPostsPublisherProcessor.name);

  constructor(
    private readonly instagramService: InstagramService,
    private readonly pinterestService: PinterestService,
    private readonly settingsService: AiSettingsService,
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

      const config = await this.settingsService.getDecryptedSocialMediaConfig(post.platform);
      
      if (!config.platformAccountId || !config.accessToken) {
        throw new Error('Platform configuration is incomplete for publishing.');
      }

      if (post.platform === 'instagram') {
        if (!post.creationId) {
          throw new Error('Missing creation_id. The media container was not created during scheduling.');
        }

        // Publish Media using existing container
        const igPostId = await this.instagramService.publishMedia(
          post.creationId, 
          config.platformAccountId, 
          config.accessToken
        );

        // Update DB
        post.platformPostId = igPostId;
      } else if (post.platform === 'facebook') {
        // Facebook natively scheduled the post at generation time via Graph API
        // So we don't need to actually call publish here. We just need to mark it as PUBLISHED in our DB.
        this.logger.log(`Post ${postId} was natively scheduled on Facebook. Marking as PUBLISHED locally.`);
      } else if (post.platform === 'pinterest') {
        const title = `${post.caption || ''}\n\n${post.hashtags || ''}`.trim() || 'Untitled Pin';
        const link = "https://woodwolff.com";
        const publicBaseUrl = process.env.APP_PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000';
        
        let pinId;
        if (post.postType?.toLowerCase() === 'carousel') {
          if (!post.mediaUrls || post.mediaUrls.length < 2) {
            throw new Error('Carousel posts must have at least 2 media items.');
          }
          const fullImageUrls = post.mediaUrls.map(url => 
            url.startsWith('http') ? url : `${publicBaseUrl}${url.startsWith('/') ? '' : '/'}${url}`
          );
          pinId = await this.pinterestService.publishCarousel(
            config.platformAccountId, 
            title, 
            link, 
            fullImageUrls, 
            config.accessToken
          );
        } else {
          const imageUrl = post.mediaUrls && post.mediaUrls.length > 0 ? post.mediaUrls[0] : null;
          if (!imageUrl) {
            throw new Error('No media generated to post to Pinterest.');
          }
          const fullImageUrl = imageUrl.startsWith('http') 
            ? imageUrl 
            : `${publicBaseUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
            
          pinId = await this.pinterestService.publishImage(
            config.platformAccountId, 
            title, 
            link, 
            fullImageUrl, 
            config.accessToken
          );
        }
        post.platformPostId = pinId;
        this.logger.log(`Successfully published post ${postId} to Pinterest!`);
      }

      post.status = SocialPostStatus.PUBLISHED;
      post.errorMessage = null;
      await this.postRepo.save(post);

      if (post.platform === 'instagram') {
        this.logger.log(`Successfully published post ${postId} to Instagram!`);
      }

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
