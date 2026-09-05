import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, Equal } from 'typeorm';
import {
  AiProductData,
  AiGenerationJob,
  AiProductDataStatus,
  AiGenerationJobStatus,
} from '../../../database/entities/ai.entity';
import { CreateAiProductDataDto, UpdateAiProductContentDto } from '../dto/ai.dto';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QUEUE_NAMES, JOB_NAMES } from '../../queue/queue.constants';
import * as fs from 'fs';
import { AiSettingsService } from './ai-settings.service';
import { ContentGenerationService } from './content-generation.service';
import { AiConfigType } from '../../../database/entities/ai.entity';
import { ItemGroupService } from '../../item-group/item-group.service';

@Injectable()
export class ProductAiService {
  private readonly logger = new Logger(ProductAiService.name);

  constructor(
    @InjectRepository(AiProductData)
    private readonly productDataRepo: Repository<AiProductData>,
    @InjectRepository(AiGenerationJob)
    private readonly jobRepo: Repository<AiGenerationJob>,
    @InjectQueue(QUEUE_NAMES.AI)
    private readonly aiQueue: Queue,
    private readonly settingsService: AiSettingsService,
    private readonly contentGenService: ContentGenerationService,
    private readonly itemGroupService: ItemGroupService,
  ) {}

  async createAiProductData(dto: CreateAiProductDataDto) {
    let originalImageUrl;

    const data = this.productDataRepo.create({
      userInput: dto,
      status: AiProductDataStatus.PENDING,
    });
    
    // Save to get the ID
    const savedData = await this.productDataRepo.save(data);

    if (dto.reference_image_base64) {
      try {
        const matches = dto.reference_image_base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const mimeType = matches[1];
          const base64Data = matches[2];
          
          let ext = 'jpg';
          if (mimeType === 'image/png') ext = 'png';
          if (mimeType === 'image/webp') ext = 'webp';

          const imagesDir = require('path').join(process.cwd(), 'public', 'generated_images', savedData.id);
          if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
          }

          const filePath = require('path').join(imagesDir, `original.${ext}`);
          fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

          savedData.userInput.original_image_url = `/api/v1/ai/images/${savedData.id}/original`;
          await this.productDataRepo.save(savedData);
        }
      } catch (err) {
        this.logger.error('Failed to save original image to disk', err);
      }
    }

    return savedData;
  }

  async listAiProducts(page: number = 1, pageSize: number = 20) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await this.productDataRepo.findAndCount({
      where: { status: Not(Equal(AiProductDataStatus.CONVERTED)) },
      order: { createdAt: 'DESC' },
      skip,
      take: pageSize,
    });
    
    return {
      items,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getAiProductData(id: string) {
    const data = await this.productDataRepo.findOne({ where: { id } });
    if (!data) {
      throw new NotFoundException(`AI Product Data with ID ${id} not found`);
    }
    return data;
  }

  async updateGeneratedContent(id: string, dto: UpdateAiProductContentDto) {
    const data = await this.getAiProductData(id);

    if (!data.generatedContent) {
      throw new BadRequestException('Cannot update content before it is generated');
    }

    data.generatedContent = {
      ...data.generatedContent,
      ...dto,
    };

    return await this.productDataRepo.save(data);
  }

  async triggerGeneration(id: string) {
    const data = await this.getAiProductData(id);

    if (data.status === AiProductDataStatus.IN_PROGRESS) {
      throw new BadRequestException('Generation is already in progress');
    }

    data.status = AiProductDataStatus.IN_PROGRESS;
    await this.productDataRepo.save(data);

    let initialImageTotal = 0;
    const hasImage = !!(data.userInput.reference_image_url || data.userInput.reference_image_base64 || data.userInput.original_image_url);
    
    if (hasImage) {
      try {
        const imageConfig = await this.settingsService.getDecryptedConfig(AiConfigType.IMAGE);
        if (imageConfig) {
          let promptsToUse: any[] = imageConfig.prompts || [];
          if (data.userInput.item_group) {
            try {
              const groupConfig = await this.itemGroupService.getConfig(data.userInput.item_group);
              if (groupConfig && groupConfig.imagePrompts && groupConfig.imagePrompts.length > 0) {
                const enabledGroupPrompts = groupConfig.imagePrompts.filter(p => p.isEnabled);
                if (enabledGroupPrompts.length > 0) {
                  promptsToUse = enabledGroupPrompts;
                }
              }
            } catch (err) {}
          }
          initialImageTotal = promptsToUse.length;
        }
      } catch (err) {}
    }

    const job = this.jobRepo.create({
      aiProductDataId: data.id,
      status: AiGenerationJobStatus.IN_PROGRESS,
      contentStatus: 'in_progress',
      imageTotal: initialImageTotal,
    });
    const savedJob = await this.jobRepo.save(job);

    try {
      // 1. Generate text content synchronously
      const contentConfig = await this.settingsService.getDecryptedConfig(AiConfigType.CONTENT);

      const generatedContent = await this.contentGenService.generateContent({
        itemName: data.userInput.item_name,
        description: data.userInput.description,
        referenceImageUrl: data.userInput.reference_image_url,
        referenceImageBase64: data.userInput.reference_image_base64,
        config: {
          provider: contentConfig.provider as any,
          model: contentConfig.model,
          apiKey: contentConfig.apiKey,
          apiSecret: contentConfig.apiSecret,
          contentPrompt: contentConfig.contentPrompt,
        },
      });

      // 2. Save text content
      data.generatedContent = generatedContent as any;
      
      if (!hasImage) {
        data.status = AiProductDataStatus.GENERATED;
        await this.productDataRepo.save(data);

        savedJob.contentStatus = 'completed';
        savedJob.status = AiGenerationJobStatus.COMPLETED;
        savedJob.completedAt = new Date();
        await this.jobRepo.save(savedJob);

        return { jobId: savedJob.id, status: 'generated' };
      }

      await this.productDataRepo.save(data);

      savedJob.contentStatus = 'completed';
      await this.jobRepo.save(savedJob);

      // 3. Queue image generation (handled asynchronously by AiGenerationProcessor)
      await this.aiQueue.add(JOB_NAMES.AI_GENERATE_PRODUCT, {
        aiProductDataId: data.id,
        imageOnly: true, // Tell processor to only run image generation
      });

    } catch (err: any) {
      // If text generation fails, mark as failed immediately
      savedJob.contentStatus = 'failed';
      savedJob.status = AiGenerationJobStatus.FAILED;
      savedJob.error = err.message;
      savedJob.completedAt = new Date();
      await this.jobRepo.save(savedJob);

      // Revert product data status to PENDING so user can retry
      data.status = AiProductDataStatus.PENDING;
      await this.productDataRepo.save(data);

      throw new BadRequestException(`Content generation failed: ${err.message}`);
    }

    return { jobId: savedJob.id };
  }

  async triggerImageGeneration(id: string) {
    const data = await this.getAiProductData(id);

    if (data.status === AiProductDataStatus.IN_PROGRESS) {
      throw new BadRequestException('Generation is already in progress');
    }

    data.status = AiProductDataStatus.IN_PROGRESS;
    data.generatedImages = [];
    await this.productDataRepo.save(data);

    const job = this.jobRepo.create({
      aiProductDataId: data.id,
      status: AiGenerationJobStatus.PENDING,
    });
    const savedJob = await this.jobRepo.save(job);

    await this.aiQueue.add(JOB_NAMES.AI_GENERATE_PRODUCT, {
      aiProductDataId: data.id,
      imageOnly: true,
    });

    return { jobId: savedJob.id };
  }

  async getGenerationStatus(aiProductDataId: string) {
    const job = await this.jobRepo.findOne({
      where: { aiProductDataId },
      order: { createdAt: 'DESC' },
    });

    if (!job) {
      throw new NotFoundException('No generation job found for this AI product data');
    }

    return job;
  }

  async markAsConverted(id: string) {
    const data = await this.getAiProductData(id);
    data.status = AiProductDataStatus.CONVERTED;
    return await this.productDataRepo.save(data);
  }

  async deleteAiProductData(id: string) {
    const data = await this.getAiProductData(id);

    // Delete image files from disk if they exist
    if (data.generatedImages && data.generatedImages.length > 0) {
      for (const img of data.generatedImages) {
        if (img.file_path && fs.existsSync(img.file_path)) {
          try {
            fs.unlinkSync(img.file_path);
          } catch (e: any) {
            this.logger.error(`Failed to delete image file ${img.file_path}: ${e.message}`);
          }
        }
      }
    }

    await this.productDataRepo.delete(id);
    return { success: true };
  }
}
