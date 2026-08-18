import { Test, TestingModule } from '@nestjs/testing';
import { ContentGenerationService } from './content-generation.service';
import { AiProviderFactory } from '../providers/ai-provider.factory';
import { AiProviderName } from '../constants/ai-models.registry';

describe('ContentGenerationService', () => {
  let service: ContentGenerationService;
  let mockProviderFactory: any;
  let mockProvider: any;

  beforeEach(async () => {
    mockProvider = {
      generateContent: jest.fn(),
    };

    mockProviderFactory = {
      getProvider: jest.fn().mockReturnValue(mockProvider),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentGenerationService,
        {
          provide: AiProviderFactory,
          useValue: mockProviderFactory,
        },
      ],
    }).compile();

    service = module.get<ContentGenerationService>(ContentGenerationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateContent', () => {
    const mockInput = {
      itemName: 'Wooden Chair',
      description: 'A nice chair',
      referenceImageUrl: 'http://example.com/image.png',
      config: {
        provider: 'openai' as AiProviderName,
        model: 'gpt-4',
        apiKey: 'secret',
        contentPrompt: 'System prompt',
      },
    };

    it('should successfully generate and validate content', async () => {
      mockProvider.generateContent.mockResolvedValue({
        title: 'Premium Wooden Chair',
        meta_title: 'Buy Premium Wooden Chair',
        meta_description: 'Best wooden chair.',
        short_description: 'A nice wooden chair.',
        description: '<p>A nice wooden chair.</p>',
      });

      const result = await service.generateContent(mockInput);

      expect(mockProviderFactory.getProvider).toHaveBeenCalledWith('openai');
      expect(mockProvider.generateContent).toHaveBeenCalledWith({
        itemName: 'Wooden Chair',
        description: 'A nice chair',
        referenceImageUrl: 'http://example.com/image.png',
        systemPrompt: 'System prompt',
        model: 'gpt-4',
        apiKey: 'secret',
      });

      expect(result.title).toBe('Premium Wooden Chair');
    });

    it('should throw an error if the provider returns incomplete fields', async () => {
      mockProvider.generateContent.mockResolvedValue({
        title: 'Premium Wooden Chair',
        // missing meta_title, meta_description, etc.
      });

      await expect(service.generateContent(mockInput)).rejects.toThrow(
        /Missing or invalid required fields in AI output/,
      );
    });

    it('should bubble up provider errors', async () => {
      mockProvider.generateContent.mockRejectedValue(new Error('Rate limited'));

      await expect(service.generateContent(mockInput)).rejects.toThrow('Rate limited');
    });
  });
});
