import { Injectable, Logger } from '@nestjs/common';
import { AI_MODEL_REGISTRY, AI_MODELS_RAW, AiProviderName } from '../constants/ai-models.registry';
import { AiModelDefinition } from '../constants/ai-models.registry';

@Injectable()
export class AiModelService {
  private readonly logger = new Logger(AiModelService.name);

  /** Returns all models in the registry */
  getAllModels(): AiModelDefinition[] {
    return AI_MODEL_REGISTRY;
  }

  /** Returns the raw JSON structure for dropdowns */
  getStructuredModels() {
    return AI_MODELS_RAW;
  }

  /** Returns models capable of content generation */
  getContentModels(): AiModelDefinition[] {
    return AI_MODEL_REGISTRY.filter((m) => m.capabilities.content);
  }

  /** Returns models capable of image generation */
  getImageModels(): AiModelDefinition[] {
    return AI_MODEL_REGISTRY.filter((m) => m.capabilities.imageGeneration);
  }

  /** Returns models for a specific provider */
  getModelsByProvider(provider: AiProviderName): AiModelDefinition[] {
    return AI_MODEL_REGISTRY.filter((m) => m.provider === provider);
  }

  /** Returns content models for a specific provider */
  getContentModelsByProvider(provider: AiProviderName): AiModelDefinition[] {
    return AI_MODEL_REGISTRY.filter(
      (m) => m.provider === provider && m.capabilities.content,
    );
  }

  /** Returns image models for a specific provider */
  getImageModelsByProvider(provider: AiProviderName): AiModelDefinition[] {
    return AI_MODEL_REGISTRY.filter(
      (m) => m.provider === provider && m.capabilities.imageGeneration,
    );
  }

  /** Returns the unique list of providers that support content generation */
  getContentProviders(): AiProviderName[] {
    const providers = new Set(
      AI_MODEL_REGISTRY.filter((m) => m.capabilities.content).map((m) => m.provider),
    );
    return Array.from(providers);
  }

  /** Returns the unique list of providers that support image generation (excludes Anthropic) */
  getImageProviders(): AiProviderName[] {
    const providers = new Set(
      AI_MODEL_REGISTRY.filter((m) => m.capabilities.imageGeneration).map(
        (m) => m.provider,
      ),
    );
    return Array.from(providers);
  }

  /** Validates that a given model supports the required capability */
  validateModelCapability(
    modelId: string,
    capability: 'content' | 'imageGeneration',
  ): boolean {
    const model = AI_MODEL_REGISTRY.find((m) => m.modelId === modelId);
    if (!model) return false;
    return model.capabilities[capability];
  }
}
