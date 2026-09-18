import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AiConfig, AiConfigType } from '../../database/entities/ai.entity';
import { decrypt } from '../../utils/crypto.util';

@Injectable()
export class AiSettingsService {
  constructor(
    @InjectRepository(AiConfig)
    private readonly aiConfigRepo: Repository<AiConfig>,
    private readonly configService: ConfigService,
  ) {}

  async getDecryptedConfig(configType: AiConfigType) {
    const config = await this.aiConfigRepo.findOne({
      where: { configType, isEnabled: true },
    });

    if (!config) {
      throw new Error(`AI ${configType} configuration is missing or disabled in database.`);
    }

    const encryptionKey = this.configService.get<string>('AI_ENCRYPTION_KEY');
    
    // ScaleMax API keys might not be encrypted in the middleware if passed via env
    if (config.provider === 'scalemax' && !config.apiKeyEncrypted) {
      const fallbackKey = this.configService.get<string>('SCALEMAX_API_KEY');
      if (fallbackKey) {
        return {
          provider: config.provider,
          model: config.model,
          generateModel: config.generateModel,
          editModel: config.editModel,
          readModel: config.readModel,
          apiKey: fallbackKey,
          url: config.url,
          generateUrl: config.generateUrl,
          editUrl: config.editUrl,
          readUrl: config.readUrl,
        };
      }
    }

    if (!config.apiKeyEncrypted) {
      throw new Error(`API key is missing for ${config.provider}`);
    }

    if (!encryptionKey || encryptionKey.length !== 64) {
      throw new InternalServerErrorException(
        'AI_ENCRYPTION_KEY environment variable is not set or invalid. It must be a 64-character hex string.',
      );
    }

    return {
      provider: config.provider,
      model: config.model,
      generateModel: config.generateModel,
      editModel: config.editModel,
      readModel: config.readModel,
      apiKey: decrypt(config.apiKeyEncrypted, encryptionKey),
      url: config.url,
      generateUrl: config.generateUrl,
      editUrl: config.editUrl,
      readUrl: config.readUrl,
    };
  }
}
