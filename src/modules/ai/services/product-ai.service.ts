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

  async listAiProducts() {
    return await this.productDataRepo.find({
      where: { status: Not(Equal(AiProductDataStatus.CONVERTED)) },
      order: { createdAt: 'DESC' },
    });
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

    const job = this.jobRepo.create({
      aiProductDataId: data.id,
      status: AiGenerationJobStatus.PENDING,
    });
    const savedJob = await this.jobRepo.save(job);

    await this.aiQueue.add(JOB_NAMES.AI_GENERATE_PRODUCT, {
      aiProductDataId: data.id,
    });

    return { jobId: savedJob.id };
  }

  async triggerImageGeneration(id: string) {
    const data = await this.getAiProductData(id);

    if (data.status === AiProductDataStatus.IN_PROGRESS) {
      throw new BadRequestException('Generation is already in progress');
    }

    data.status = AiProductDataStatus.IN_PROGRESS;
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
