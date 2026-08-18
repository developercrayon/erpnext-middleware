import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AiProviderFactory } from '../providers/ai-provider.factory';
import { AiProviderName } from '../constants/ai-models.registry';
import { ContentGenerationOutput } from '../providers/ai-provider.interface';

export interface GenerateContentOptions {
  itemName: string;
  description: string;
  referenceImageUrl?: string;
  referenceImageBase64?: string;
  config: {
    provider: AiProviderName;
    model: string;
    apiKey: string;
    apiSecret?: string;
    contentPrompt?: string;
  };
}

@Injectable()
export class ContentGenerationService {
  constructor(private readonly providerFactory: AiProviderFactory) {}

  async generateContent(options: GenerateContentOptions): Promise<ContentGenerationOutput> {
    const provider = this.providerFactory.getProvider(options.config.provider);

    const result = await provider.generateContent({
      itemName: options.itemName,
      description: options.description,
      referenceImageUrl: options.referenceImageUrl,
      referenceImageBase64: options.referenceImageBase64,
      systemPrompt: options.config.contentPrompt,
      model: options.config.model,
      apiKey: options.config.apiKey,
      apiSecret: options.config.apiSecret,
    });

    this.validateOutput(result);

    return result;
  }

  private validateOutput(output: any) {
    const requiredFields = [
      'title',
      'meta_title',
      'meta_description',
      'short_description',
      'description',
    ];

    for (const field of requiredFields) {
      if (typeof output[field] !== 'string') {
        throw new InternalServerErrorException(
          `Missing or invalid required fields in AI output. Expected string for '${field}'.`,
        );
      }
    }
  }
}
