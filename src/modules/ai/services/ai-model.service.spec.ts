import { Test, TestingModule } from '@nestjs/testing';
import { AiModelService } from './ai-model.service';
import { AI_MODEL_REGISTRY } from '../constants/ai-models.registry';

describe('AiModelService', () => {
  let service: AiModelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiModelService],
    }).compile();

    service = module.get<AiModelService>(AiModelService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return all models', () => {
    const models = service.getAllModels();
    expect(models).toEqual(AI_MODEL_REGISTRY);
    expect(models.length).toBeGreaterThan(0);
  });

  it('should return only content models', () => {
    const contentModels = service.getContentModels();
    expect(contentModels.every((m) => m.capabilities.content)).toBe(true);
    expect(contentModels.some((m) => !m.capabilities.content)).toBe(false);
  });

  it('should return only image models', () => {
    const imageModels = service.getImageModels();
    expect(imageModels.every((m) => m.capabilities.imageGeneration)).toBe(true);
    expect(imageModels.some((m) => !m.capabilities.imageGeneration)).toBe(false);
  });

  it('should filter models by provider', () => {
    const openaiModels = service.getModelsByProvider('openai');
    expect(openaiModels.every((m) => m.provider === 'openai')).toBe(true);
    
    const anthropicModels = service.getModelsByProvider('anthropic');
    expect(anthropicModels.every((m) => m.provider === 'anthropic')).toBe(true);
  });

  it('should return content providers including anthropic', () => {
    const providers = service.getContentProviders();
    expect(providers).toContain('openai');
    expect(providers).toContain('anthropic');
    expect(providers).toContain('google');
  });

  it('should return image providers EXCLUDING anthropic', () => {
    const providers = service.getImageProviders();
    expect(providers).toContain('openai');
    expect(providers).toContain('google');
    expect(providers).not.toContain('anthropic'); // Anthropic does not support image generation
  });

  it('should validate model capability correctly', () => {
    // GPT 4.1 supports content but not image
    expect(service.validateModelCapability('gpt-4.1', 'content')).toBe(true);
    expect(service.validateModelCapability('gpt-4.1', 'imageGeneration')).toBe(false);

    // GPT Image 1 supports image but not content
    expect(service.validateModelCapability('gpt-image-1', 'imageGeneration')).toBe(true);
    expect(service.validateModelCapability('gpt-image-1', 'content')).toBe(false);

    // Invalid model returns false
    expect(service.validateModelCapability('invalid-model', 'content')).toBe(false);
  });
});
