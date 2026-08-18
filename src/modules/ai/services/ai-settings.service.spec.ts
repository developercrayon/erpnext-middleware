import { Test, TestingModule } from '@nestjs/testing';
import { AiSettingsService } from './ai-settings.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiConfig, AiConfigType, AiImagePrompt } from '../../../database/entities/ai.entity';
import { AiEncryptionService } from './ai-encryption.service';
import { AiModelService } from './ai-model.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('AiSettingsService', () => {
  let service: AiSettingsService;
  let mockConfigRepo: any;
  let mockPromptRepo: any;
  let mockEncryptionService: any;
  let mockModelService: any;

  beforeEach(async () => {
    mockConfigRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    mockPromptRepo = {
      delete: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    mockEncryptionService = {
      encrypt: jest.fn((text) => `encrypted_${text}`),
      decrypt: jest.fn((text) => text.replace('encrypted_', '')),
    };

    mockModelService = {
      validateModelCapability: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiSettingsService,
        {
          provide: getRepositoryToken(AiConfig),
          useValue: mockConfigRepo,
        },
        {
          provide: getRepositoryToken(AiImagePrompt),
          useValue: mockPromptRepo,
        },
        {
          provide: AiEncryptionService,
          useValue: mockEncryptionService,
        },
        {
          provide: AiModelService,
          useValue: mockModelService,
        },
      ],
    }).compile();

    service = module.get<AiSettingsService>(AiSettingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSafeSettings', () => {
    it('should return default settings if no config exists', async () => {
      mockConfigRepo.findOne.mockResolvedValue(null);
      const result = await service.getSafeSettings(AiConfigType.CONTENT);
      expect(result.isConfigured).toBe(false);
      expect(result.provider).toBe('');
      expect((result as any).apiKeyEncrypted).toBeUndefined();
    });

    it('should never return raw keys in safe settings', async () => {
      mockConfigRepo.findOne.mockResolvedValue({
        id: '123',
        configType: AiConfigType.CONTENT,
        provider: 'openai',
        model: 'gpt-4',
        apiKeyEncrypted: 'encrypted_secret',
        isEnabled: true,
      });

      const result = await service.getSafeSettings(AiConfigType.CONTENT);
      expect(result.isConfigured).toBe(true);
      expect(result.provider).toBe('openai');
      expect((result as any).apiKeyEncrypted).toBeUndefined();
      expect((result as any).apiKey).toBeUndefined();
    });
  });

  describe('upsertContentSettings', () => {
    it('should encrypt API key before saving', async () => {
      mockModelService.validateModelCapability.mockReturnValue(true);
      mockConfigRepo.findOne.mockResolvedValue(null);
      mockConfigRepo.create.mockImplementation((data) => data);
      mockConfigRepo.save.mockResolvedValue({ id: '123' });

      await service.upsertContentSettings({
        provider: 'openai',
        model: 'gpt-4.1',
        apiKey: 'my-secret-key',
        contentPrompt: 'System prompt',
      });

      expect(mockEncryptionService.encrypt).toHaveBeenCalledWith('my-secret-key');
      expect(mockConfigRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyEncrypted: 'encrypted_my-secret-key',
        }),
      );
    });

    it('should throw if capability is invalid', async () => {
      mockModelService.validateModelCapability.mockReturnValue(false);

      await expect(
        service.upsertContentSettings({
          provider: 'openai',
          model: 'invalid-model',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getDecryptedConfig', () => {
    it('should return decrypted key for internal use', async () => {
      mockConfigRepo.findOne.mockResolvedValue({
        id: '123',
        configType: AiConfigType.CONTENT,
        provider: 'openai',
        model: 'gpt-4',
        apiKeyEncrypted: 'encrypted_secret_key',
        isEnabled: true,
      });

      const result = await service.getDecryptedConfig(AiConfigType.CONTENT);
      expect(result.apiKey).toBe('secret_key');
      expect(mockEncryptionService.decrypt).toHaveBeenCalledWith('encrypted_secret_key');
    });

    it('should throw NotFoundException if config is missing', async () => {
      mockConfigRepo.findOne.mockResolvedValue(null);

      await expect(service.getDecryptedConfig(AiConfigType.CONTENT)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
