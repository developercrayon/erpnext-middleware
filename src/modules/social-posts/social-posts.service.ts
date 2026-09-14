import { Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class SocialPostsService {
  constructor(
    @InjectRepository(SocialPost)
    private readonly postRepo: Repository<SocialPost>,
    @InjectRepository(SocialCampaign)
    private readonly campaignRepo: Repository<SocialCampaign>,
    @InjectQueue(QUEUE_NAMES.AI)
    private readonly aiQueue: Queue,
    private readonly settingsService: AiSettingsService,
    private readonly contentGenService: ContentGenerationService,
    private readonly productsService: ProductsService,
  ) {}

  async getCampaigns(): Promise<SocialCampaign[]> {
    return this.campaignRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getPosts(page = 1, limit = 10, platform?: string, search?: string) {
    const query = this.postRepo.createQueryBuilder('post')
      .leftJoinAndMapOne('post.campaign', SocialCampaign, 'campaign', 'campaign.id = post.campaignId')
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
    const post = this.postRepo.create({
      ...dto,
      status: SocialPostStatus.GENERATING, // Keep GENERATING to indicate media is pending
    });

    // 1. Fetch Product Data from ERPNext via products module
    const productsData = await this.productsService.findAll({ search: post.productItemCode });
    const product = productsData.data.find(p => p.sku === post.productItemCode || p.name === post.productItemCode);
    
    if (!product) {
      throw new Error(`Product ${post.productItemCode} not found in ERPNext`);
    }

    const itemName = product.name || post.productItemCode;
    const description = product.description || '';
    let contentReferenceImageUrl = product.images?.[0] || '';

    if (post.customPrompts) {
      if (post.customPrompts.selectedReelPromptImages && Array.isArray(post.customPrompts.selectedReelPromptImages) && post.customPrompts.selectedReelPromptImages.length > 0) {
        contentReferenceImageUrl = post.customPrompts.selectedReelPromptImages[0];
      } else if (post.customPrompts.selectedImagePromptImages && Array.isArray(post.customPrompts.selectedImagePromptImages) && post.customPrompts.selectedImagePromptImages.length > 0) {
        // Fallback to Image Prompt images for content if reel prompt images not selected
        contentReferenceImageUrl = post.customPrompts.selectedImagePromptImages[0];
      }
    }

    // 2. Fetch Content AI settings
    let contentConfig: any;
    try {
      contentConfig = await this.settingsService.getDecryptedConfig(AiConfigType.CONTENT);
    } catch (err) {
      // Ignore error, will just skip content gen
    }

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

      const generatedContent = await this.contentGenService.generateContent({
        itemName,
        description,
        referenceImageUrl: contentReferenceImageUrl,
        config: {
          provider: contentConfig.provider as any,
          model: contentConfig.model,
          apiKey: contentConfig.apiKey,
          apiSecret: contentConfig.apiSecret,
          contentPrompt: systemPrompt,
        },
      });

      // Parse generatedContent if it comes back as stringified JSON or object
      let parsed: any = generatedContent;
      if (typeof generatedContent === 'string') {
         try {
           parsed = JSON.parse(generatedContent);
         } catch (e) {
           // Fallback if not valid JSON
           parsed = { generatedPost: generatedContent };
         }
      }

      post.caption = parsed.caption || '';
      post.hashtags = parsed.hashtags || '';
      post.videoReelScript = parsed.videoReelScript || '';
    }

    const savedPost = await this.postRepo.save(post);

    // Enqueue background job to generate images/media
    await this.aiQueue.add(
      JOB_NAMES.AI_GENERATE_SOCIAL_POST,
      {
        socialPostId: savedPost.id,
        productItemCode: savedPost.productItemCode,
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
    return this.postRepo.save(post);
  }
}
