import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SocialPost, SocialPostStatus } from '../../database/entities/social-post.entity';
import { SocialCampaign } from '../../database/entities/social-campaign.entity';
import { CreateSocialPostDto, UpdateSocialPostDto, ScheduleSocialPostDto } from './social-posts.dto';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

import { AiSettingsService } from '../ai/services/ai-settings.service';
import { ContentGenerationService } from '../ai/services/content-generation.service';
import { ProductsService } from '../products/products.service';
import { AiConfigType } from '../../database/entities/ai.entity';
import { InstagramService } from './instagram.service';
import { FacebookService } from './facebook.service';
import { PinterestService } from './pinterest.service';

@Injectable()
export class SocialPostsService {
  constructor(
    @InjectRepository(SocialPost)
    private readonly postRepo: Repository<SocialPost>,
    @InjectRepository(SocialCampaign)
    private readonly campaignRepo: Repository<SocialCampaign>,
    @InjectQueue(QUEUE_NAMES.AI)
    private readonly aiQueue: Queue,
    @InjectQueue(QUEUE_NAMES.SOCIAL_POSTS)
    private readonly socialPostsQueue: Queue,
    private readonly settingsService: AiSettingsService,
    private readonly contentGenService: ContentGenerationService,
    private readonly productsService: ProductsService,
    private readonly instagramService: InstagramService,
    private readonly facebookService: FacebookService,
    private readonly pinterestService: PinterestService,
  ) {}

  async getCampaigns(): Promise<SocialCampaign[]> {
    return this.campaignRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getPosts(page = 1, limit = 10, platform?: string, search?: string) {
    const query = this.postRepo.createQueryBuilder('post')
      .leftJoinAndMapOne('post.campaign', SocialCampaign, 'campaign', 'campaign.id::text = post.campaignId')
      .orderBy('post.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (platform) {
      query.andWhere('post.platform = :platform', { platform });
    }

    if (search) {
      query.andWhere('post.productItemCode ILIKE :search', { search: `%${search}%` });
    }

    const [items, total] = await query.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPostById(id: string): Promise<SocialPost> {
    const post = await this.postRepo.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException(`Social Post with ID ${id} not found`);
    }
    return post;
  }

  async generatePost(dto: CreateSocialPostDto): Promise<SocialPost> {
    let post: SocialPost;

    if (dto.postId) {
      const existing = await this.postRepo.findOne({ where: { id: dto.postId } });
      if (existing) {
        post = Object.assign(existing, dto);
        post.status = SocialPostStatus.GENERATING;
        post.errorMessage = null;
        post.mediaUrls = []; // Clear old media urls on regenerate
      } else {
        post = this.postRepo.create({
          ...dto,
          status: SocialPostStatus.GENERATING,
        });
      }
    } else {
      post = this.postRepo.create({
        ...dto,
        status: SocialPostStatus.GENERATING, // Keep GENERATING to indicate media is pending
      });
    }

    // 1. Fetch Product Data from ERPNext via products module
    const productsData = await this.productsService.findAll({ search: post.productItemCode });
    const product = productsData.data.find(p => p.sku === post.productItemCode || p.name === post.productItemCode);
    
    if (!product) {
      throw new Error(`Product ${post.productItemCode} not found in ERPNext`);
    }

    const itemName = product.name || post.productItemCode;
    const description = product.description || '';
    let contentReferenceImageUrl = product.images?.[0] || '';

    let contentReferenceImageUrls: string[] = [];

    if (post.customPrompts) {
      if (post.customPrompts.selectedReelPromptImages && Array.isArray(post.customPrompts.selectedReelPromptImages) && post.customPrompts.selectedReelPromptImages.length > 0) {
        contentReferenceImageUrls = post.customPrompts.selectedReelPromptImages;
        contentReferenceImageUrl = contentReferenceImageUrls[0];
      } else if (post.customPrompts.selectedImagePromptImages && Array.isArray(post.customPrompts.selectedImagePromptImages) && post.customPrompts.selectedImagePromptImages.length > 0) {
        // Fallback to Image Prompt images for content if reel prompt images not selected
        contentReferenceImageUrls = post.customPrompts.selectedImagePromptImages;
        contentReferenceImageUrl = contentReferenceImageUrls[0];
      }
    }

    const logger = new Logger('SocialPostsService');
    
    // 2. Fetch Content AI settings
    const contentConfig = await this.settingsService.getDecryptedConfig(AiConfigType.CONTENT);
    if (!contentConfig) {
      throw new Error('AI Content Configuration not found. Please set up your AI keys in Settings.');
    }
    
    logger.log(`Found content config: ${contentConfig.provider}`);

    if (contentConfig) {
      // We inject the social media context into the system prompt.
      const defaultPrompt = `You are a social media expert. Create a post for ${post.platform}.
      Post Type: ${post.postType}. 
      Marketing Goal: ${post.marketingGoal || 'Drive engagement and sales'}.
      Product Name: {itemName}
      Product Description: {description}
      
      Return ONLY valid JSON with keys: caption, hashtags, videoReelScript.`;

      // If customPrompts are provided, we bundle them into the system prompt.
      let systemPrompt = defaultPrompt;
      if (post.customPrompts) {
        systemPrompt = `You are a social media expert. Create a post for ${post.platform}. Post Type: ${post.postType}.
        Product Name: {itemName}
        Product Description: {description}
        
        Please generate the following fields based on these specific instructions:
        - caption: ${post.customPrompts.caption || 'Generate an engaging caption.'}
        - hashtags: ${post.customPrompts.hashtag || 'Generate relevant hashtags.'}
        - videoReelScript: ${post.customPrompts.videoReel || 'Generate a short video reel script.'}
        
        Return ONLY valid JSON with keys: caption, hashtags, videoReelScript.`;
      }

      logger.log(`Calling generateContent...`);
      try {
        const generatedContent = await this.contentGenService.generateContent({
          itemName,
          description,
          referenceImageUrl: contentReferenceImageUrl,
          referenceImageUrls: contentReferenceImageUrls.length > 0 ? contentReferenceImageUrls : (contentReferenceImageUrl ? [contentReferenceImageUrl] : []),
          config: {
            provider: contentConfig.provider as any,
            model: contentConfig.model,
            apiKey: contentConfig.apiKey,
            apiSecret: contentConfig.apiSecret,
            contentPrompt: systemPrompt,
          },
        });
        
        logger.log(`Received generatedContent: ${JSON.stringify(generatedContent)}`);

        // Parse generatedContent if it comes back as stringified JSON or object
        let parsed: any = generatedContent;
        if (typeof generatedContent === 'string') {
           try {
             parsed = JSON.parse(generatedContent);
           } catch (e) {
             // Fallback if not valid JSON
             parsed = { caption: generatedContent };
           }
        }
        
        // Handle common nested JSON wrappers from OpenAI
        if (parsed.post && !parsed.caption) {
           parsed = parsed.post;
        } else if (parsed.data && !parsed.caption) {
           parsed = parsed.data;
        } else if (parsed.socialPost && !parsed.caption) {
           parsed = parsed.socialPost;
        }

        post.caption = typeof parsed.caption === 'string' ? parsed.caption.replace(/[""]/g, '') : (parsed.caption || '');
        post.hashtags = typeof parsed.hashtags === 'string' ? parsed.hashtags.replace(/[{}""]/g, '') : (parsed.hashtags || '');
        post.videoReelScript = parsed.videoReelScript || '';
      } catch (err) {
        logger.error(`Failed to generate content: ${err.message}`);
      }
    }

    if (post.postType === 'message') {
      post.status = SocialPostStatus.DRAFT;
      return await this.postRepo.save(post);
    }

    const savedPost = await this.postRepo.save(post);

    // Enqueue background job to generate images/media
    await this.aiQueue.add(
      JOB_NAMES.AI_GENERATE_SOCIAL_POST,
      {
        socialPostId: savedPost.id,
        productItemCode: savedPost.productItemCode,
        selectedImagePromptBase64s: dto.selectedImagePromptBase64s,
        selectedReelPromptBase64s: dto.selectedReelPromptBase64s,
        selectedContentPromptBase64s: dto.selectedContentPromptBase64s,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return savedPost;
  }

  async updatePost(id: string, dto: UpdateSocialPostDto): Promise<SocialPost> {
    const post = await this.getPostById(id);
    Object.assign(post, dto);
    return this.postRepo.save(post);
  }

  async schedulePost(id: string, dto: ScheduleSocialPostDto): Promise<SocialPost> {
    const post = await this.getPostById(id);
    post.scheduledAt = new Date(dto.scheduledAt);
    post.status = SocialPostStatus.SCHEDULED;

    // Fetch config for this platform
    if (post.platform === 'instagram') {
      const config = await this.settingsService.getDecryptedSocialMediaConfig('instagram');
      
      if (!config.platformAccountId || !config.accessToken) {
        throw new Error('Instagram configuration is incomplete. Please select a page in AI settings.');
      }
      
      const captionText = `${post.caption || ''}\n\n${post.hashtags || ''}`.trim();
      const publicBaseUrl = process.env.APP_PUBLIC_URL || process.env.APP_URL || 'https://inkretix.t3package.com';

      if (post.postType?.toLowerCase() === 'carousel') {
        if (!post.mediaUrls || post.mediaUrls.length < 2) {
          throw new Error('Carousel posts must have at least 2 media items.');
        }

        const childCreationIds: string[] = [];
        for (const imageUrl of post.mediaUrls) {
          const fullImageUrl = imageUrl.startsWith('http') 
            ? imageUrl 
            : `${publicBaseUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
          
          const childId = await this.instagramService.createCarouselItemContainer(
            fullImageUrl,
            config.platformAccountId,
            config.accessToken
          );
          childCreationIds.push(childId);
        }

        const creationId = await this.instagramService.createCarouselContainer(
          childCreationIds,
          captionText,
          config.platformAccountId,
          config.accessToken
        );
        post.creationId = creationId;

      } else {
        const imageUrl = post.mediaUrls && post.mediaUrls.length > 0 ? post.mediaUrls[0] : null;
        if (!imageUrl) {
          throw new Error('No media generated to post to Instagram.');
        }
        
        const fullImageUrl = imageUrl.startsWith('http') 
          ? imageUrl 
          : `${publicBaseUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;

        // Create static/reel/story container
        let creationId;
        if (post.postType?.toLowerCase() === 'story') {
          creationId = await this.instagramService.createStoryMediaContainer(
            fullImageUrl,
            config.platformAccountId,
            config.accessToken
          );
        } else {
          creationId = await this.instagramService.createMediaContainer(
            fullImageUrl,
            captionText,
            config.platformAccountId,
            config.accessToken
          );
        }
        
        post.creationId = creationId;
      }
    } else if (post.platform === 'facebook') {
      const config = await this.settingsService.getDecryptedSocialMediaConfig('facebook');
      
      if (!config.platformAccountId || !config.accessToken) {
        throw new Error('Facebook configuration is incomplete. Please select a page in AI settings.');
      }
      
      const captionText = `${post.caption || ''}\n\n${post.hashtags || ''}`.trim();
      const publicBaseUrl = process.env.APP_PUBLIC_URL || process.env.APP_URL || 'https://inkretix.t3package.com';
      const scheduledTime = Math.floor(post.scheduledAt.getTime() / 1000);

      // Extract the Page Access Token if available from the cached pagesList
      let facebookAccessToken = config.accessToken;
      if (config.pagesList && Array.isArray(config.pagesList)) {
        const selectedPage = config.pagesList.find((p: any) => p.id === config.platformAccountId);
        if (selectedPage && selectedPage.access_token) {
          facebookAccessToken = selectedPage.access_token;
        }
      }

      if (post.postType?.toLowerCase() === 'message') {
        const creationId = await this.facebookService.publishMessage(
          captionText,
          config.platformAccountId,
          facebookAccessToken,
          scheduledTime
        );
        post.creationId = creationId;
        post.platformPostId = creationId;
      } else if (post.postType?.toLowerCase() === 'carousel') {
        if (!post.mediaUrls || post.mediaUrls.length < 2) {
          throw new Error('Carousel posts must have at least 2 media items.');
        }

        const childCreationIds: string[] = [];
        for (const imageUrl of post.mediaUrls) {
          const fullImageUrl = imageUrl.startsWith('http') 
            ? imageUrl 
            : `${publicBaseUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
          
          const childId = await this.facebookService.uploadCarouselPhoto(
            fullImageUrl,
            config.platformAccountId,
            facebookAccessToken
          );
          childCreationIds.push(childId);
        }

        const creationId = await this.facebookService.publishCarousel(
          childCreationIds,
          captionText,
          config.platformAccountId,
          facebookAccessToken,
          scheduledTime
        );
        post.creationId = creationId;
        post.platformPostId = creationId;
      } else if (post.postType?.toLowerCase() === 'story') {
        const imageUrl = post.mediaUrls && post.mediaUrls.length > 0 ? post.mediaUrls[0] : null;
        if (!imageUrl) {
          throw new Error('No media generated to post to Facebook Story.');
        }
        
        const fullImageUrl = imageUrl.startsWith('http') 
          ? imageUrl 
          : `${publicBaseUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;

        const creationId = await this.facebookService.publishStory(
          fullImageUrl,
          config.platformAccountId,
          facebookAccessToken,
          scheduledTime
        );
        post.creationId = creationId;
        post.platformPostId = creationId;
      } else {
        // Feed Image
        const imageUrl = post.mediaUrls && post.mediaUrls.length > 0 ? post.mediaUrls[0] : null;
        if (!imageUrl) {
          throw new Error('No media generated to post to Facebook.');
        }
        
        const fullImageUrl = imageUrl.startsWith('http') 
          ? imageUrl 
          : `${publicBaseUrl}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;

        const creationId = await this.facebookService.publishImage(
          fullImageUrl,
          captionText,
          config.platformAccountId,
          facebookAccessToken,
          scheduledTime
        );
        post.creationId = creationId;
        post.platformPostId = creationId;
      }
      
      // Since Facebook posts are natively scheduled via Graph API,
      // we mark them with a distinct status.
      post.status = SocialPostStatus.SCHEDULED_PUBLISH;
    }

    const savedPost = await this.postRepo.save(post);

    // Calculate delay
    const delay = savedPost.scheduledAt.getTime() - Date.now();
    
    // Add to publisher queue
    await this.socialPostsQueue.add(
      JOB_NAMES.PUBLISH_SOCIAL_POST,
      { postId: savedPost.id },
      { delay: Math.max(delay, 0) }
    );

    return savedPost;
  }

  async getInstagramPages() {
    const config = await this.settingsService.getDecryptedSocialMediaConfig('instagram');
    if (!config.accessToken) {
      throw new Error('Instagram access token is missing.');
    }
    
    // Check if pages list is already cached
    if (config.pagesList && Array.isArray(config.pagesList) && config.pagesList.length > 0) {
      return { 
        pages: config.pagesList,
        selectedPageId: config.selectedPageId,
      };
    }

    const pages = await this.instagramService.getPages(config.accessToken);
    
    // Cache in DB
    await this.settingsService.updateSocialMediaConfig('instagram', { pagesList: pages });
    
    return {
      pages,
      selectedPageId: config.selectedPageId,
    };
  }

  async selectInstagramPage(pageId: string) {
    const config = await this.settingsService.getDecryptedSocialMediaConfig('instagram');
    if (!config.accessToken) {
      throw new Error('Instagram access token is missing.');
    }

    const igUserId = await this.instagramService.getBusinessAccount(pageId, config.accessToken);
    
    await this.settingsService.updateSocialMediaConfig('instagram', {
      selectedPageId: pageId,
      platformAccountId: igUserId,
    });

    return { success: true, igUserId };
  }

  async getFacebookPages() {
    const config = await this.settingsService.getDecryptedSocialMediaConfig('facebook');
    if (!config.accessToken) {
      throw new Error('Facebook access token is missing.');
    }
    
    // Check if pages list is already cached
    if (config.pagesList && Array.isArray(config.pagesList) && config.pagesList.length > 0) {
      return { 
        pages: config.pagesList,
        selectedPageId: config.selectedPageId,
      };
    }

    // Fetch from Facebook Graph API
    const pages = await this.facebookService.getPages(config.accessToken);
    
    // Cache in DB
    await this.settingsService.updateSocialMediaConfig('facebook', { pagesList: pages });
    
    return {
      pages,
      selectedPageId: config.selectedPageId,
    };
  }

  async selectFacebookPage(pageId: string) {
    const config = await this.settingsService.getDecryptedSocialMediaConfig('facebook');
    if (!config.accessToken) {
      throw new Error('Facebook access token is missing.');
    }

    // For Facebook, the platformAccountId is just the pageId directly
    await this.settingsService.updateSocialMediaConfig('facebook', {
      selectedPageId: pageId,
      platformAccountId: pageId,
    });
    
    return { success: true };
  }

  async getPinterestBoards() {
    const config = await this.settingsService.getDecryptedSocialMediaConfig('pinterest');
    if (!config.accessToken) {
      throw new Error('Pinterest access token is missing.');
    }
    
    // Check if boards list is already cached
    if (config.pagesList && Array.isArray(config.pagesList) && config.pagesList.length > 0) {
      return { 
        boards: config.pagesList,
        selectedBoardId: config.selectedPageId,
      };
    }

    // Fetch from Pinterest API
    const boards = await this.pinterestService.getBoards(config.accessToken, config.apiBaseUrl, config.apiVersion);
    
    // Cache in DB
    await this.settingsService.updateSocialMediaConfig('pinterest', { pagesList: boards });
    
    return {
      boards,
      selectedBoardId: config.selectedPageId,
    };
  }

  async selectPinterestBoard(boardId: string) {
    const config = await this.settingsService.getDecryptedSocialMediaConfig('pinterest');
    if (!config.accessToken) {
      throw new Error('Pinterest access token is missing.');
    }

    await this.settingsService.updateSocialMediaConfig('pinterest', {
      selectedPageId: boardId,
      platformAccountId: boardId,
    });

    return { success: true, boardId };
  }
}
