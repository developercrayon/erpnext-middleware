import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_NAMES, JOB_NAMES } from '../../queue/queue.constants';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AiProductData,
  AiGenerationJob,
  AiConfigType,
  AiProductDataStatus,
  AiGenerationJobStatus,
} from '../../../database/entities/ai.entity';
import { AiSettingsService } from '../services/ai-settings.service';
import { ContentGenerationService } from '../services/content-generation.service';
import { ImageGenerationService } from '../services/image-generation.service';
import { Logger } from '@nestjs/common';

@Processor(QUEUE_NAMES.AI)
export class AiGenerationProcessor {
  private readonly logger = new Logger(AiGenerationProcessor.name);

  constructor(
    @InjectRepository(AiProductData)
    private readonly productDataRepo: Repository<AiProductData>,
    @InjectRepository(AiGenerationJob)
    private readonly jobRepo: Repository<AiGenerationJob>,
    private readonly settingsService: AiSettingsService,
    private readonly contentGenService: ContentGenerationService,
    private readonly imageGenService: ImageGenerationService,
  ) {}

  @Process(JOB_NAMES.AI_GENERATE_PRODUCT)
  async handleGenerateProduct(job: Job<{ aiProductDataId: string; imageOnly?: boolean }>) {
    const { aiProductDataId, imageOnly } = job.data;
    this.logger.log(`Starting AI generation job for ProductData ${aiProductDataId} (imageOnly: ${!!imageOnly})`);

    const aiJob = await this.jobRepo.findOne({
      where: { aiProductDataId, status: AiGenerationJobStatus.PENDING },
      order: { createdAt: 'DESC' },
    });

    if (!aiJob) {
      throw new Error(`Job tracking record not found for data ID ${aiProductDataId}`);
    }

    const productData = await this.productDataRepo.findOne({
      where: { id: aiProductDataId },
    });

    if (!productData) {
      throw new Error(`AI Product Data not found for ID ${aiProductDataId}`);
    }

    try {
      // 1. Mark job as in-progress
      aiJob.status = AiGenerationJobStatus.IN_PROGRESS;
      aiJob.startedAt = new Date();
      await this.jobRepo.save(aiJob);

      // 2. Fetch Content AI settings & generate content
      if (!imageOnly) {
        try {
          aiJob.contentStatus = 'in_progress';
          await this.jobRepo.save(aiJob);

          const contentConfig = await this.settingsService.getDecryptedConfig(AiConfigType.CONTENT);

          const generatedContent = await this.contentGenService.generateContent({
            itemName: productData.userInput.item_name,
            description: productData.userInput.description,
            referenceImageUrl: productData.userInput.reference_image_url,
            referenceImageBase64: productData.userInput.reference_image_base64,
            config: {
              provider: contentConfig.provider as any,
              model: contentConfig.model,
              apiKey: contentConfig.apiKey,
              apiSecret: contentConfig.apiSecret,
              contentPrompt: contentConfig.contentPrompt,
            },
          });

          productData.generatedContent = generatedContent;
          await this.productDataRepo.save(productData);

          aiJob.contentStatus = 'completed';
          await this.jobRepo.save(aiJob);
        } catch (err: any) {
          aiJob.contentStatus = 'failed';
          throw new Error(`Content Generation Failed: ${err.message}`);
        }
      }

      // 3. Fetch Image AI settings & generate images
      try {
        let imageConfig: any;
        try {
          imageConfig = await this.settingsService.getDecryptedConfig(AiConfigType.IMAGE);
        } catch (err) {
          this.logger.warn(`Skipping image generation: ${err.message}`);
          imageConfig = null;
        }

        if (imageConfig && imageConfig.prompts && imageConfig.prompts.length > 0) {
          aiJob.imageTotal = imageConfig.prompts.length;
          await this.jobRepo.save(aiJob);

          const generatedImages = await this.imageGenService.generateImages({
            dataId: productData.id,
            itemName: productData.userInput.item_name,
            prompts: imageConfig.prompts,
            referenceImageUrl: productData.userInput.reference_image_url,
            referenceImageBase64: productData.userInput.reference_image_base64,
            config: {
              provider: imageConfig.provider as any,
              model: imageConfig.model,
              apiKey: imageConfig.apiKey,
              apiSecret: imageConfig.apiSecret,
            },
            onProgress: async (result, currentResults) => {
              productData.generatedImages = currentResults;
              await this.productDataRepo.save(productData);

              aiJob.imageCompleted = currentResults.filter((img) => img.success).length;
              aiJob.imageFailed = currentResults.filter((img) => !img.success).length;
              await this.jobRepo.save(aiJob);
            }
          });

          // Generated images and job counts are saved progressively in onProgress
        }
      } catch (err: any) {
        this.logger.error(`Image Generation Phase Failed: ${err.message}`);
        // We do not fail the entire job if only image generation fails unexpectedly.
      }

      // 4. Mark everything as completed
      aiJob.status = AiGenerationJobStatus.COMPLETED;
      aiJob.completedAt = new Date();
      await this.jobRepo.save(aiJob);

      productData.status = AiProductDataStatus.GENERATED;
      productData.generatedAt = new Date();
      await this.productDataRepo.save(productData);

      this.logger.log(`Completed AI generation job for ProductData ${aiProductDataId}`);
    } catch (error: any) {
      this.logger.error(`AI Generation job failed: ${error.message}`);
      
      aiJob.status = AiGenerationJobStatus.FAILED;
      aiJob.error = error.message;
      aiJob.completedAt = new Date();
      await this.jobRepo.save(aiJob);

      // Revert product data status to PENDING so user can retry
      productData.status = AiProductDataStatus.PENDING;
      await this.productDataRepo.save(productData);

      throw error;
    }
  }
}
