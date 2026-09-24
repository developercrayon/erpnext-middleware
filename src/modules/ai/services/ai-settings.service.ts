import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiConfig, AiConfigType, AiImagePrompt, AiSocialMediaConfig } from '../../../database/entities/ai.entity';
import { AiEncryptionService } from './ai-encryption.service';
import { AiModelService } from './ai-model.service';
import { UpsertContentAiDto, UpsertImageAiDto, UpsertSocialMediaDto } from '../dto/ai.dto';
import axios from 'axios';

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
      generateModel: config.generateModel,
      editModel: config.editModel,
      readModel: config.readModel,
      isEnabled: config.isEnabled,
      url: config.url,
      generateUrl: config.generateUrl,
      editUrl: config.editUrl,
      readUrl: config.readUrl,
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
      generateModel: config.generateModel,
      editModel: config.editModel,
      readModel: config.readModel,
      apiKey: config.apiKeyEncrypted ? this.encryptionService.decrypt(config.apiKeyEncrypted) : (config.provider === 'scalemax' ? process.env.SCALEMAX_API_KEY : undefined),
      apiSecret: config.apiSecretEncrypted
        ? this.encryptionService.decrypt(config.apiSecretEncrypted)
        : undefined,
      url: config.url,
      generateUrl: config.generateUrl,
      editUrl: config.editUrl,
      readUrl: config.readUrl,
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
    if (dto.url !== undefined) config.url = dto.url;
    if (dto.generateUrl !== undefined) config.generateUrl = dto.generateUrl;
    if (dto.editUrl !== undefined) config.editUrl = dto.editUrl;
    if (dto.readUrl !== undefined) config.readUrl = dto.readUrl;

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

    if (dto.generateModel !== undefined) config.generateModel = dto.generateModel;
    if (dto.editModel !== undefined) config.editModel = dto.editModel;
    if (dto.readModel !== undefined) config.readModel = dto.readModel;

    if (dto.isEnabled !== undefined) {
      config.isEnabled = dto.isEnabled;
    }

    if (dto.url !== undefined) config.url = dto.url;
    if (dto.generateUrl !== undefined) config.generateUrl = dto.generateUrl;
    if (dto.editUrl !== undefined) config.editUrl = dto.editUrl;
    if (dto.readUrl !== undefined) config.readUrl = dto.readUrl;

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
      credentialsValid: c.credentialsValid,
      appName: c.appName,
      appId: c.appId,
      clientId: c.clientId,
      isClientSecretConfigured: !!c.clientSecretEncrypted,
      isAccessTokenConfigured: !!c.accessTokenEncrypted,
      consumerKey: c.consumerKey,
      signatureMethod: c.signatureMethod,
      isConsumerSecretConfigured: !!c.consumerSecretEncrypted,
      isAccessTokenSecretConfigured: !!c.accessTokenSecretEncrypted,
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

    // Pre-validate all DTOs before saving any
    for (const dto of dtos) {
      if (dto.isEnabled && !dto.credentialsValid) {
        throw new BadRequestException(`Unable to save: Invalid credentials for platform ${dto.platform || 'Unknown'}. Please validate credentials first.`);
      }
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
      if (dto.credentialsValid !== undefined) config.credentialsValid = dto.credentialsValid;
      if (dto.appName !== undefined) config.appName = dto.appName;
      if (dto.appId !== undefined) config.appId = dto.appId;
      if (dto.clientId !== undefined) config.clientId = dto.clientId;
      
      if (dto.clientSecret) {
        config.clientSecretEncrypted = this.encryptionService.encrypt(dto.clientSecret);
      }
      
      if (dto.accessToken) {
        config.accessTokenEncrypted = this.encryptionService.encrypt(dto.accessToken);
      }

      if (dto.consumerKey !== undefined) config.consumerKey = dto.consumerKey;

      if (dto.consumerSecret) {
        config.consumerSecretEncrypted = this.encryptionService.encrypt(dto.consumerSecret);
      }

      if (dto.accessTokenSecret) {
        config.accessTokenSecretEncrypted = this.encryptionService.encrypt(dto.accessTokenSecret);
      }

      if (dto.signatureMethod !== undefined) config.signatureMethod = dto.signatureMethod;
      if (dto.platformAccountId !== undefined) config.platformAccountId = dto.platformAccountId;
      
      if (dto.authorizationUrl !== undefined) config.authorizationUrl = dto.authorizationUrl;
      if (dto.tokenUrl !== undefined) config.tokenUrl = dto.tokenUrl;
      if (dto.apiBaseUrl !== undefined) config.apiBaseUrl = dto.apiBaseUrl;
      if (dto.apiVersion !== undefined) config.apiVersion = dto.apiVersion;
      if (dto.prompts !== undefined) config.prompts = dto.prompts as any;
      
      await this.socialMediaRepo.save(config);
    }
  }

  async getDecryptedSocialMediaConfig(platform: string) {
    const config = await this.socialMediaRepo.findOne({ where: { platform } });
    if (!config) {
      throw new Error(`Social media configuration for platform ${platform} not found.`);
    }

    return {
      ...config,
      accessToken: config.accessTokenEncrypted ? this.encryptionService.decrypt(config.accessTokenEncrypted) : null,
      clientSecret: config.clientSecretEncrypted ? this.encryptionService.decrypt(config.clientSecretEncrypted) : null,
      consumerSecret: config.consumerSecretEncrypted ? this.encryptionService.decrypt(config.consumerSecretEncrypted) : null,
      accessTokenSecret: config.accessTokenSecretEncrypted ? this.encryptionService.decrypt(config.accessTokenSecretEncrypted) : null,
    };
  }

  async updateSocialMediaConfig(platform: string, updates: Partial<AiSocialMediaConfig>) {
    const config = await this.socialMediaRepo.findOne({ where: { platform } });
    if (!config) {
      throw new Error(`Social media configuration for platform ${platform} not found.`);
    }
    Object.assign(config, updates);
    await this.socialMediaRepo.save(config);
  }

  async validateSocialToken(dto: UpsertSocialMediaDto): Promise<{ success: boolean; accessToken?: string; message?: string }> {
    try {
      if (dto.platform === 'instagram' || dto.platform === 'facebook') {
        let tokenToValidate = dto.accessToken;
        if (!tokenToValidate && dto.id) {
          const existing = await this.socialMediaRepo.findOne({ where: { id: dto.id } });
          if (existing && existing.accessTokenEncrypted) {
            tokenToValidate = this.encryptionService.decrypt(existing.accessTokenEncrypted);
          }
        }

        if (!tokenToValidate) {
          throw new BadRequestException(`Access token is required to validate ${dto.platform === 'facebook' ? 'Facebook' : 'Instagram'} credentials`);
        }

        const response = await axios.get('https://graph.facebook.com/debug_token', {
          params: {
            input_token: tokenToValidate,
            access_token: tokenToValidate
          }
        });

        if (response.data?.data?.is_valid) {
          return { success: true, accessToken: dto.accessToken ? tokenToValidate : undefined };
        } else {
          return { 
            success: false, 
            message: response.data?.data?.error?.message || 'Token is invalid or expired'
          };
        }
      }

      if (dto.platform === 'linkedin') {
        let tokenToValidate = dto.accessToken;
        if (!tokenToValidate && dto.id) {
          const existing = await this.socialMediaRepo.findOne({ where: { id: dto.id } });
          if (existing && existing.accessTokenEncrypted) {
            tokenToValidate = this.encryptionService.decrypt(existing.accessTokenEncrypted);
          }
        }

        if (!tokenToValidate) {
          throw new BadRequestException('Access token is required to validate LinkedIn credentials');
        }

        const response = await axios.get('https://api.linkedin.com/v2/userinfo', {
          headers: {
            'Authorization': `Bearer ${tokenToValidate}`,
            'X-Restli-Protocol-Version': '2.0.0'
          }
        });

        if (response.data && response.data.sub) {
          return { success: true, accessToken: dto.accessToken ? tokenToValidate : undefined };
        } else {
          return { 
            success: false, 
            message: 'Invalid response from LinkedIn API'
          };
        }
      }

      if (dto.platform === 'pinterest') {
        let tokenToValidate = dto.accessToken;
        if (!tokenToValidate && dto.id) {
          const existing = await this.socialMediaRepo.findOne({ where: { id: dto.id } });
          if (existing && existing.accessTokenEncrypted) {
            tokenToValidate = this.encryptionService.decrypt(existing.accessTokenEncrypted);
          }
        }

        if (!tokenToValidate) {
          throw new BadRequestException('Access token is required to validate Pinterest credentials');
        }

        const baseUrl = dto.apiBaseUrl && dto.apiVersion ? `${dto.apiBaseUrl}/${dto.apiVersion}` : 'https://api-sandbox.pinterest.com/v5';
        const response = await axios.get(`${baseUrl}/user_account`, {
          headers: {
            'Authorization': `Bearer ${tokenToValidate}`
          }
        });

        if (response.data && response.data.username) {
          return { success: true, accessToken: dto.accessToken ? tokenToValidate : undefined };
        } else {
          return { 
            success: false, 
            message: 'Invalid response from Pinterest API'
          };
        }
      }

      if (dto.platform === 'x') {
        let consumerKey = dto.consumerKey;
        let consumerSecret = dto.consumerSecret;
        let token = dto.accessToken;
        let tokenSecret = dto.accessTokenSecret;
        
        if (dto.id && (!consumerSecret || !tokenSecret)) {
          const existing = await this.socialMediaRepo.findOne({ where: { id: dto.id } });
          if (existing) {
            if (!consumerSecret && existing.consumerSecretEncrypted) {
              consumerSecret = this.encryptionService.decrypt(existing.consumerSecretEncrypted);
            }
            if (!tokenSecret && existing.accessTokenSecretEncrypted) {
              tokenSecret = this.encryptionService.decrypt(existing.accessTokenSecretEncrypted);
            }
            if (!consumerKey) consumerKey = existing.consumerKey;
            if (!token) token = this.encryptionService.decrypt(existing.accessTokenEncrypted);
          }
        }

        if (!consumerKey || !consumerSecret || !token || !tokenSecret) {
          throw new BadRequestException('All 4 OAuth keys are required to validate X credentials');
        }

        const url = 'https://api.twitter.com/2/users/me';
        const method = 'GET';
        
        const crypto = require('crypto');
        const nonce = crypto.randomBytes(16).toString('hex');
        const timestamp = Math.floor(Date.now() / 1000).toString();
        
        const params: Record<string, string> = {
          oauth_consumer_key: consumerKey,
          oauth_nonce: nonce,
          oauth_signature_method: 'HMAC-SHA1',
          oauth_timestamp: timestamp,
          oauth_token: token,
          oauth_version: '1.0'
        };
        
        const encode = (str: string) => encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        
        const sortedKeys = Object.keys(params).sort();
        const parameterString = sortedKeys.map(k => `${encode(k)}=${encode(params[k])}`).join('&');
        
        const signatureBaseString = `${method}&${encode(url)}&${encode(parameterString)}`;
        const signingKey = `${encode(consumerSecret)}&${encode(tokenSecret)}`;
        
        const signature = crypto.createHmac('sha1', signingKey).update(signatureBaseString).digest('base64');
        params.oauth_signature = signature;
        
        const authHeader = 'OAuth ' + Object.keys(params)
          .sort()
          .map(k => `${encode(k)}="${encode(params[k])}"`)
          .join(', ');

        const response = await axios.get(url, {
          headers: {
            Authorization: authHeader,
          }
        });

        if (response.data && response.data.data) {
          return { success: true, accessToken: dto.accessToken };
        } else {
          return { success: false, message: 'Invalid response from X API' };
        }
      }

      if (!dto.tokenUrl) {
        throw new BadRequestException('Token URL is required');
      }

      const params: Record<string, string> = {
        grant_type: 'client_credentials', // Default common grant type
      };

      if (dto.appId) params.client_id = dto.appId;
      if (dto.clientId) params.client_id = dto.clientId;
      
      if (dto.clientSecret) {
        params.client_secret = dto.clientSecret;
      } else {
        // If client secret is not provided in DTO, it might be saved in DB already
        if (dto.id) {
          const existing = await this.socialMediaRepo.findOne({ where: { id: dto.id } });
          if (existing && existing.clientSecretEncrypted) {
            params.client_secret = this.encryptionService.decrypt(existing.clientSecretEncrypted);
          }
        }
      }

      if (!params.client_secret) {
        throw new BadRequestException('Client secret is required to validate credentials');
      }

      const response = await axios.get(dto.tokenUrl, { params });
      const accessToken = response.data.access_token || response.data.token;

      if (!accessToken) {
        throw new Error('API request succeeded but no access token was returned.');
      }

      return { success: true, accessToken };
    } catch (error: any) {
      return { 
        success: false, 
        message: error?.response?.data?.error?.message || error?.response?.data?.message || error?.response?.data?.detail || error.message || 'Validation failed'
      };
    }
  }
}
