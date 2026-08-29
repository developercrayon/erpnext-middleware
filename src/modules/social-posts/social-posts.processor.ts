import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialPost, SocialPostStatus } from '../../database/entities/social-post.entity';
import { AiSettingsService } from '../ai/services/ai-settings.service';
import { ContentGenerationService } from '../ai/services/content-generation.service';
import { ImageGenerationService } from '../ai/services/image-generation.service';
import { ProductsService } from '../products/products.service';
import { AiConfigType } from '../../database/entities/ai.entity';
import { Logger } from '@nestjs/common';

@Processor(QUEUE_NAMES.AI)
export class SocialPostsProcessor {
  private readonly logger = new Logger(SocialPostsProcessor.name);

  constructor(
    @InjectRepository(SocialPost)
    private readonly postRepo: Repository<SocialPost>,
    private readonly settingsService: AiSettingsService,
    private readonly contentGenService: ContentGenerationService,
    private readonly imageGenService: ImageGenerationService,
    private readonly productsService: ProductsService,
  ) {}

  @Process(JOB_NAMES.AI_GENERATE_SOCIAL_POST)
  async handleGenerateSocialPost(job: Job<{ socialPostId: string; productItemCode: string }>) {
    const { socialPostId, productItemCode } = job.data;
    this.logger.log(`Starting AI generation job for Social Post ${socialPostId}`);

    const post = await this.postRepo.findOne({ where: { id: socialPostId } });
    if (!post) {
      throw new Error(`Social Post not found for ID ${socialPostId}`);
    }

    try {
      // 1. Fetch Product Data from ERPNext via products module
      const productsData = await this.productsService.findAll({ search: productItemCode });
      const product = productsData.data.find(p => p.sku === productItemCode || p.name === productItemCode);
      
      if (!product) {
        throw new Error(`Product ${productItemCode} not found in ERPNext`);
      }

      const itemName = product.name || productItemCode;
      const description = product.description || '';
      let contentReferenceImageUrl = product.images?.[0] || '';
      let imageReferenceImageUrl = product.images?.[0] || '';

      if (post.customPrompts) {
        if (post.customPrompts.selectedReelPromptImages && Array.isArray(post.customPrompts.selectedReelPromptImages) && post.customPrompts.selectedReelPromptImages.length > 0) {
          contentReferenceImageUrl = post.customPrompts.selectedReelPromptImages[0];
        } else if (post.customPrompts.selectedImagePromptImages && Array.isArray(post.customPrompts.selectedImagePromptImages) && post.customPrompts.selectedImagePromptImages.length > 0) {
          // Fallback to Image Prompt images for content if reel prompt images not selected
          contentReferenceImageUrl = post.customPrompts.selectedImagePromptImages[0];
        }

        if (post.customPrompts.selectedImagePromptImages && Array.isArray(post.customPrompts.selectedImagePromptImages) && post.customPrompts.selectedImagePromptImages.length > 0) {
          imageReferenceImageUrl = post.customPrompts.selectedImagePromptImages[0];
        }
      }

      // 2. Fetch Content AI settings
      let contentConfig: any;
      try {
        contentConfig = await this.settingsService.getDecryptedConfig(AiConfigType.CONTENT);
      } catch (err) {
        this.logger.warn(`Skipping content generation: ${err.message}`);
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
        
        await this.postRepo.save(post);
      }

      // 3. Image generation (optional, can be expanded to use the image prompts)
      let imageConfig: any;
      try {
        imageConfig = await this.settingsService.getDecryptedConfig(AiConfigType.IMAGE);
      } catch (err) {
        this.logger.warn(`Skipping image generation: ${err.message}`);
      }

      if (imageConfig && imageConfig.prompts && imageConfig.prompts.length > 0) {
         let imagePrompt = imageConfig.prompts[0];
         if (post.customPrompts && post.customPrompts.image) {
            imagePrompt = post.customPrompts.image;
            // Inject variables if they are present in the custom prompt
            imagePrompt = imagePrompt.replace(/{itemName}/g, itemName);
            imagePrompt = imagePrompt.replace(/{description}/g, description);
         }

         const generatedImages = await this.imageGenService.generateImages({
            dataId: post.id,
            itemName,
            prompts: [imagePrompt],
            referenceImageUrl: imageReferenceImageUrl,
            config: {
              provider: imageConfig.provider as any,
              model: imageConfig.model,
              apiKey: imageConfig.apiKey,
              apiSecret: imageConfig.apiSecret,
            },
         });
         
         post.mediaUrls = generatedImages.filter(img => img.success).map(img => img.serve_url);
         await this.postRepo.save(post);
      }

      post.status = SocialPostStatus.GENERATED_READY_FOR_REVIEW;
      await this.postRepo.save(post);
      this.logger.log(`Completed AI generation job for Social Post ${socialPostId}`);
    } catch (error: any) {
      this.logger.error(`Social Post AI Generation job failed: ${error.message}`);
      post.status = SocialPostStatus.FAILED;
      post.errorMessage = error.message;
      await this.postRepo.save(post);
      throw error;
    }
  }
}
