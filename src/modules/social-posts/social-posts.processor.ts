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
  async handleGenerateSocialPost(job: Job<{ 
    socialPostId: string; 
    productItemCode: string;
    selectedImagePromptBase64s?: string[];
    selectedReelPromptBase64s?: string[];
    selectedContentPromptBase64s?: string[];
  }>) {
    const { socialPostId, productItemCode } = job.data;
    this.logger.log(`Starting AI generation job for Social Post ${socialPostId}`);

    const post = await this.postRepo.findOne({ where: { id: socialPostId } });
    if (!post) {
      throw new Error(`Social Post not found for ID ${socialPostId}`);
    }

    try {
      // 1. Fetch Product Data from ERPNext via products module (if provided)
      let product = null;
      if (productItemCode) {
        const productsData = await this.productsService.findAll({ search: productItemCode });
        product = productsData.data.find(p => p.sku === productItemCode || p.name === productItemCode);
        if (!product) {
          this.logger.warn(`Product ${productItemCode} not found in ERPNext. Proceeding without product metadata.`);
        }
      }

      const itemName = product?.name || productItemCode || 'Product';
      const description = product?.description || '';
      let contentReferenceImageUrl = product?.images?.[0] || '';
      let imageReferenceImageUrl = product?.images?.[0] || '';

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

      if (post.selectedImagePromptImages && post.selectedImagePromptImages.length > 0) {
        imageReferenceImageUrl = post.selectedImagePromptImages[0];
      }

      // Note: Text content (caption, hashtags) is now generated synchronously in the service.
      // This processor only handles media generation.

      // Fetch Image AI settings

      let imageConfig: any;
      try {
        imageConfig = await this.settingsService.getDecryptedConfig(AiConfigType.IMAGE);
      } catch (err) {
        this.logger.warn(`Skipping image generation: ${err.message}`);
      }

      if (imageConfig && ((imageConfig.prompts && imageConfig.prompts.length > 0) || (post.customPrompts && post.customPrompts.image))) {
         if (post.postType?.toLowerCase() === 'message' || post.postType?.toLowerCase() === 'text') {
           this.logger.log(`Skipping image generation for text-only post`);
         } else {
           let imagePrompt = "";
         
         if (post.customPrompts && post.customPrompts.image) {
            imagePrompt = post.customPrompts.image;
            // Inject variables if they are present in the custom prompt
            imagePrompt = imagePrompt.replace(/{itemName}/g, itemName);
            imagePrompt = imagePrompt.replace(/{description}/g, description);
         } else if (imageConfig.prompts && imageConfig.prompts.length > 0) {
            imagePrompt = imageConfig.prompts[0].promptText || imageConfig.prompts[0];
         }

         let promptsToUse: any[] = [];
         
         if (post.postType?.toLowerCase() === 'carousel' && post.selectedImagePromptImages && post.selectedImagePromptImages.length > 0) {
           // For carousels, generate an image for EACH selected reference image
           promptsToUse = post.selectedImagePromptImages.map((img, idx) => {
             // Find custom prompt override by index since the same image might be selected multiple times
             const customPromptObj = post.customPrompts?.carouselPrompts?.[idx] as any;
             const specificPrompt = (customPromptObj && customPromptObj.prompt && typeof customPromptObj.prompt === 'string' && customPromptObj.prompt.trim() !== "") 
               ? customPromptObj.prompt 
               : imagePrompt;
             
             // Optionally inject itemName/description into specific prompt as well
             let finalSpecificPrompt = specificPrompt;
             finalSpecificPrompt = finalSpecificPrompt.replace(/{itemName}/g, itemName);
             finalSpecificPrompt = finalSpecificPrompt.replace(/{description}/g, description);

             return {
               promptText: finalSpecificPrompt,
               referenceImageUrl: img,
               referenceImageBase64: job.data.selectedImagePromptBase64s?.[idx]
             };
           });
         } else {
           // For static/reel, generate one image
           promptsToUse = [{ 
             promptText: imagePrompt, 
             referenceImageUrl: imageReferenceImageUrl,
             referenceImageBase64: job.data.selectedImagePromptBase64s?.[0]
           }];
         }

         const generatedImages = await this.imageGenService.generateImages({
            dataId: post.id,
            itemName,
            prompts: promptsToUse,
            config: {
              provider: imageConfig.provider as any,
              model: imageConfig.model,
              apiKey: imageConfig.apiKey,
              apiSecret: imageConfig.apiSecret,
              url: imageConfig.url,
              generateUrl: imageConfig.generateUrl,
              editUrl: imageConfig.editUrl,
              readUrl: imageConfig.readUrl,
              generateModel: imageConfig.generateModel,
              editModel: imageConfig.editModel,
            },
         });
         const successfulImages = generatedImages.filter(img => img.success);
         const failedImages = generatedImages.filter(img => !img.success);
         
         if (successfulImages.length > 0) {
           post.mediaUrls = successfulImages.map(img => img.serve_url);
           await this.postRepo.save(post);
         }
         
         if (failedImages.length > 0) {
           throw new Error(failedImages[0].error || `Failed to generate ${failedImages.length} images`);
         }
         }
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
