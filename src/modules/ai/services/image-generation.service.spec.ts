import { Test, TestingModule } from '@nestjs/testing';
import { ImageGenerationService } from './image-generation.service';
import { AiProviderFactory } from '../providers/ai-provider.factory';
import { AiProviderName } from '../constants/ai-models.registry';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('fs');

describe('ImageGenerationService', () => {
  let service: ImageGenerationService;
  let mockProviderFactory: any;
  let mockProvider: any;

  beforeEach(async () => {
    mockProvider = {
      generateImage: jest.fn(),
    };

    mockProviderFactory = {
      getProvider: jest.fn().mockReturnValue(mockProvider),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageGenerationService,
        {
          provide: AiProviderFactory,
          useValue: mockProviderFactory,
        },
      ],
    }).compile();

    service = module.get<ImageGenerationService>(ImageGenerationService);
    
    // Clear mock calls between tests
    jest.clearAllMocks();
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateImages', () => {
    const mockOptions = {
      dataId: '123-abc',
      itemName: 'Wooden Chair',
      prompts: [
        { id: 'p1', promptText: 'Show it in a living room' },
        { id: 'p2', promptText: 'Show it on a white background' },
      ] as any[],
      config: {
        provider: 'openai' as AiProviderName,
        model: 'gpt-image-1',
        apiKey: 'secret',
      },
    };

    it('should generate multiple images and write them to disk', async () => {
      mockProvider.generateImage
        .mockResolvedValueOnce({
          imageBase64: 'base64-data-1',
          mimeType: 'image/png',
        })
        .mockResolvedValueOnce({
          imageBase64: 'base64-data-2',
          mimeType: 'image/png',
        });

      const results = await service.generateImages(mockOptions);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);

      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
      
      const expectedPath1 = path.join(process.cwd(), 'public', 'ai-images', '123-abc_0.png');
      expect(fs.writeFileSync).toHaveBeenNthCalledWith(1, expectedPath1, expect.any(Buffer));
      
      expect(results[0].serve_url).toBe('/api/v1/ai/images/123-abc/0');
      expect(results[0].filename).toBe('123-abc_0.png');
    });

    it('should handle partial failures without throwing', async () => {
      mockProvider.generateImage
        .mockResolvedValueOnce({
          imageBase64: 'base64-data-1',
          mimeType: 'image/png',
        })
        .mockRejectedValueOnce(new Error('Rate limit exceeded'));

      const results = await service.generateImages(mockOptions);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('Rate limit exceeded');
      expect(results[1].file_path).toBe(''); // no file path for failed image

      // Should only write 1 file
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
