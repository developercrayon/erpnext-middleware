import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConfig, AiConfigType, AiImagePrompt, AiSocialMediaConfig } from '../../../database/entities/ai.entity';
import { AiEncryptionService } from './ai-encryption.service';
import { AiModelService } from './ai-model.service';
import { UpsertContentAiDto, UpsertImageAiDto, UpsertSocialMediaDto } from '../dto/ai.dto';

@Injectable()
export class AiSettingsService {
  constructor(
    @InjectRepository(AiConfig)
    private readonly configRepo: Repository<AiConfig>,
    @InjectRepository(AiImagePrompt)
    private readonly promptRepo: Repository<AiImagePrompt>,
    @InjectRepository(AiSocialMediaConfig)
    private readonly socialMediaRepo: Repository<AiSocialMediaConfig>,
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
      masterPrompt: config.imageMasterPrompt,
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

    if (!config || (!config.apiKeyEncrypted && !(config.provider === 'scalemax' && process.env.SCALEMAX_API_KEY))) {
      throw new NotFoundException(`AI ${configType} configuration is missing or incomplete.`);
    }

    return {
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKeyEncrypted ? this.encryptionService.decrypt(config.apiKeyEncrypted) : (config.provider === 'scalemax' ? process.env.SCALEMAX_API_KEY : undefined),
      apiSecret: config.apiSecretEncrypted
        ? this.encryptionService.decrypt(config.apiSecretEncrypted)
        : undefined,
      contentPrompt: config.contentPrompt,
      imageMasterPrompt: config.imageMasterPrompt,
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

    if (dto.masterPrompt !== undefined) {
      config.imageMasterPrompt = dto.masterPrompt;
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

  async getSocialMediaSettings(): Promise<any[]> {
    const configs = await this.socialMediaRepo.find();
    return configs.map((c) => ({
      id: c.id,
      platform: c.platform,
      isEnabled: c.isEnabled,
      appName: c.appName,
      appId: c.appId,
      clientId: c.clientId,
      isClientSecretConfigured: !!c.clientSecretEncrypted,
      authorizationUrl: c.authorizationUrl,
      tokenUrl: c.tokenUrl,
      apiBaseUrl: c.apiBaseUrl,
      apiVersion: c.apiVersion,
      prompts: c.prompts || {},
    }));
  }

  async upsertSocialMediaSettings(dtos: UpsertSocialMediaDto[]): Promise<void> {
    const existingConfigs = await this.socialMediaRepo.find();
    
    // Find configs to delete (not present in new list, if we assume it overwrites)
    // Actually, maybe we only update or add what is sent. 
    // Usually, array sent replaces the whole list, so let's clear and save or update by ID.
    const incomingIds = dtos.map(d => d.id).filter(id => id);
    
    // Remove ones that were deleted by user
    const toDelete = existingConfigs.filter(ec => !incomingIds.includes(ec.id));
    if (toDelete.length > 0) {
      await this.socialMediaRepo.remove(toDelete);
    }

    for (const dto of dtos) {
      let config: AiSocialMediaConfig;
      
      if (dto.id) {
        config = await this.socialMediaRepo.findOne({ where: { id: dto.id } });
        if (!config) {
          config = this.socialMediaRepo.create();
        }
      } else {
        config = this.socialMediaRepo.create();
      }

      config.platform = dto.platform;
      
      if (dto.isEnabled !== undefined) config.isEnabled = dto.isEnabled;
      if (dto.appName !== undefined) config.appName = dto.appName;
      if (dto.appId !== undefined) config.appId = dto.appId;
      if (dto.clientId !== undefined) config.clientId = dto.clientId;
      
      if (dto.clientSecret) {
        config.clientSecretEncrypted = this.encryptionService.encrypt(dto.clientSecret);
      }
      
      if (dto.authorizationUrl !== undefined) config.authorizationUrl = dto.authorizationUrl;
      if (dto.tokenUrl !== undefined) config.tokenUrl = dto.tokenUrl;
      if (dto.apiBaseUrl !== undefined) config.apiBaseUrl = dto.apiBaseUrl;
      if (dto.apiVersion !== undefined) config.apiVersion = dto.apiVersion;
      if (dto.prompts !== undefined) config.prompts = dto.prompts as any;
      
      await this.socialMediaRepo.save(config);
    }
  }
}
