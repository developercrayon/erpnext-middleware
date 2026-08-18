import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConfig, AiConfigType, AiImagePrompt } from '../../../database/entities/ai.entity';
import { AiEncryptionService } from './ai-encryption.service';
import { AiModelService } from './ai-model.service';
import { UpsertContentAiDto, UpsertImageAiDto } from '../dto/ai.dto';

@Injectable()
export class AiSettingsService {
  constructor(
    @InjectRepository(AiConfig)
    private readonly configRepo: Repository<AiConfig>,
    @InjectRepository(AiImagePrompt)
    private readonly promptRepo: Repository<AiImagePrompt>,
    private readonly encryptionService: AiEncryptionService,
    private readonly modelService: AiModelService,
  ) {}

  /**
   * Safe getter for admin UI — NEVER returns API keys
   */
  async getSafeSettings(configType: AiConfigType): Promise<any> {
    const config = await this.configRepo.findOne({
      where: { configType },
      relations: configType === AiConfigType.IMAGE ? ['imagePrompts'] : [],
    });

    if (!config) {
      return {
        isConfigured: false,
        provider: '',
        model: '',
        isEnabled: false,
        contentPrompt: '',
        prompts: [],
      };
    }

    // Sort image prompts if they exist
    if (config.imagePrompts) {
      config.imagePrompts.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    return {
      isConfigured: !!config.apiKeyEncrypted,
      provider: config.provider,
      model: config.model,
      isEnabled: config.isEnabled,
      contentPrompt: config.contentPrompt,
      prompts: config.imagePrompts
        ? config.imagePrompts.map((p) => ({
            id: p.id,
            promptText: p.promptText,
            isEnabled: p.isEnabled,
          }))
        : [],
    };
  }

  /**
   * Internal getter for generation jobs — returns decrypted credentials
   */
  async getDecryptedConfig(configType: AiConfigType) {
    const config = await this.configRepo.findOne({
      where: { configType },
      relations: configType === AiConfigType.IMAGE ? ['imagePrompts'] : [],
    });

    if (!config || !config.apiKeyEncrypted) {
      throw new NotFoundException(`AI ${configType} configuration is missing or incomplete.`);
    }

    return {
      provider: config.provider,
      model: config.model,
      apiKey: this.encryptionService.decrypt(config.apiKeyEncrypted),
      apiSecret: config.apiSecretEncrypted
        ? this.encryptionService.decrypt(config.apiSecretEncrypted)
        : undefined,
      contentPrompt: config.contentPrompt,
      prompts: config.imagePrompts?.filter((p) => p.isEnabled) || [],
    };
  }

  async upsertContentSettings(dto: UpsertContentAiDto): Promise<void> {
    if (!this.modelService.validateModelCapability(dto.model, 'content')) {
      throw new BadRequestException(`Model ${dto.model} does not support content generation`);
    }

    let config = await this.configRepo.findOne({ where: { configType: AiConfigType.CONTENT } });

    if (!config) {
      config = this.configRepo.create({ configType: AiConfigType.CONTENT });
    }

    config.provider = dto.provider;
    config.model = dto.model;
    
    if (dto.contentPrompt !== undefined) {
      config.contentPrompt = dto.contentPrompt;
    }
    
    if (dto.isEnabled !== undefined) {
      config.isEnabled = dto.isEnabled;
    }

    if (dto.apiKey) {
      config.apiKeyEncrypted = this.encryptionService.encrypt(dto.apiKey);
    }
    
    if (dto.apiSecret) {
      config.apiSecretEncrypted = this.encryptionService.encrypt(dto.apiSecret);
    }

    await this.configRepo.save(config);
  }

  async upsertImageSettings(dto: UpsertImageAiDto): Promise<void> {
    if (!this.modelService.validateModelCapability(dto.model, 'imageGeneration')) {
      throw new BadRequestException(`Model ${dto.model} does not support image generation`);
    }

    let config = await this.configRepo.findOne({
      where: { configType: AiConfigType.IMAGE },
      relations: ['imagePrompts'],
    });

    if (!config) {
      config = this.configRepo.create({ configType: AiConfigType.IMAGE });
    }

    config.provider = dto.provider;
    config.model = dto.model;

    if (dto.isEnabled !== undefined) {
      config.isEnabled = dto.isEnabled;
    }

    if (dto.apiKey) {
      config.apiKeyEncrypted = this.encryptionService.encrypt(dto.apiKey);
    }
    
    if (dto.apiSecret) {
      config.apiSecretEncrypted = this.encryptionService.encrypt(dto.apiSecret);
    }

    const savedConfig = await this.configRepo.save(config);

    // Update image prompts if provided
    if (dto.prompts) {
      // Delete existing prompts
      await this.promptRepo.delete({ aiConfigId: savedConfig.id });

      // Save new prompts
      const newPrompts = dto.prompts.map((p, index) =>
        this.promptRepo.create({
          aiConfigId: savedConfig.id,
          promptText: p.promptText,
          isEnabled: p.isEnabled ?? true,
          sortOrder: index,
        }),
      );

      if (newPrompts.length > 0) {
        await this.promptRepo.save(newPrompts);
      }
    }
  }
}
