/**
 * Static registry of all supported AI models with their capabilities.
 * This is the single source of truth for model selection in the admin UI
 * and for validating user-configured models.
 */

export type AiProviderName = 'openai' | 'anthropic' | 'google';

export interface AiModelCapabilities {
  /** Can generate text content (product title, description, SEO fields) */
  content: boolean;
  /** Can generate images */
  imageGeneration: boolean;
  /** Can accept an image as input (vision / multimodal) */
  imageInput: boolean;
}

export interface AiModelDefinition {
  provider: AiProviderName;
  modelId: string;
  displayName: string;
  capabilities: AiModelCapabilities;
}

import * as fs from 'fs';
import * as path from 'path';

export const AI_MODELS_RAW = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'ai-models.json'), 'utf8')
);

export const AI_MODEL_REGISTRY: AiModelDefinition[] = [];

if (AI_MODELS_RAW.content) {
  for (const [provider, models] of Object.entries(AI_MODELS_RAW.content)) {
    for (const model of (models as any[])) {
      if (model.active) {
        AI_MODEL_REGISTRY.push({
          provider: provider as AiProviderName,
          modelId: model.key,
          displayName: model.name,
          capabilities: { content: true, imageGeneration: false, imageInput: true },
        });
      }
    }
  }
}

if (AI_MODELS_RAW.image) {
  for (const [provider, models] of Object.entries(AI_MODELS_RAW.image)) {
    for (const model of (models as any[])) {
      if (model.active) {
        AI_MODEL_REGISTRY.push({
          provider: provider as AiProviderName,
          modelId: model.key,
          displayName: model.name,
          capabilities: { content: false, imageGeneration: true, imageInput: false },
        });
      }
    }
  }
}
