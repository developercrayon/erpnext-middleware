import { Injectable, BadRequestException } from '@nestjs/common';
import { AIProvider } from './ai-provider.interface';
import { AiProviderName } from '../constants/ai-models.registry';

// We will implement these concrete providers in the next step
import { OpenAiProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';
import { GoogleProvider } from './google.provider';

@Injectable()
export class AiProviderFactory {
  constructor(
    private readonly openAiProvider: OpenAiProvider,
    private readonly anthropicProvider: AnthropicProvider,
    private readonly googleProvider: GoogleProvider,
  ) {}

  /**
   * Returns the appropriate concrete AI provider instance based on the provider name.
   */
  getProvider(providerName: AiProviderName): AIProvider {
    switch (providerName) {
      case 'openai':
        return this.openAiProvider;
      case 'anthropic':
        return this.anthropicProvider;
      case 'google':
        return this.googleProvider;
      default:
        throw new BadRequestException(`Unsupported AI provider: ${providerName}`);
    }
  }
}
