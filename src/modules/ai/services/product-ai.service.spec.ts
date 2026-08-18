import { Test, TestingModule } from '@nestjs/testing';
import { ProductAiService } from './product-ai.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AiProductData, AiGenerationJob, AiProductDataStatus, AiGenerationJobStatus } from '../../../database/entities/ai.entity';
import { Queue } from 'bull';
import { getQueueToken } from '@nestjs/bull';
import { QUEUE_NAMES, JOB_NAMES } from '../../queue/queue.constants';

describe('ProductAiService', () => {
  let service: ProductAiService;
  let mockProductDataRepo: any;
  let mockJobRepo: any;
  let mockAiQueue: any;

  beforeEach(async () => {
    mockProductDataRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      delete: jest.fn(),
    };

    mockJobRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
    };

    mockAiQueue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductAiService,
        {
          provide: getRepositoryToken(AiProductData),
          useValue: mockProductDataRepo,
        },
        {
          provide: getRepositoryToken(AiGenerationJob),
          useValue: mockJobRepo,
        },
        {
          provide: getQueueToken(QUEUE_NAMES.AI),
          useValue: mockAiQueue,
        },
      ],
    }).compile();

    service = module.get<ProductAiService>(ProductAiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createAiProductData', () => {
    it('should create and save a new AiProductData record', async () => {
      const dto = { item_name: 'Test', description: 'Desc' };
      mockProductDataRepo.create.mockReturnValue({ ...dto, status: AiProductDataStatus.PENDING });
      mockProductDataRepo.save.mockResolvedValue({ id: '123', ...dto, status: AiProductDataStatus.PENDING });

      const result = await service.createAiProductData(dto);

      expect(mockProductDataRepo.create).toHaveBeenCalledWith({ userInput: dto, status: AiProductDataStatus.PENDING });
      expect(mockProductDataRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('123');
      expect(result.status).toBe(AiProductDataStatus.PENDING);
    });
  });

  describe('triggerGeneration', () => {
    it('should update status and enqueue job', async () => {
      mockProductDataRepo.findOne.mockResolvedValue({ id: '123', status: AiProductDataStatus.PENDING });
      mockProductDataRepo.save.mockResolvedValue({ id: '123', status: AiProductDataStatus.IN_PROGRESS });
      
      mockJobRepo.create.mockReturnValue({ aiProductDataId: '123' });
      mockJobRepo.save.mockResolvedValue({ id: 'job-123', aiProductDataId: '123' });

      mockAiQueue.add.mockResolvedValue({ id: 'bull-123' });

      const result = await service.triggerGeneration('123');

      expect(mockProductDataRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: AiProductDataStatus.IN_PROGRESS }));
      expect(mockJobRepo.save).toHaveBeenCalled();
      expect(mockAiQueue.add).toHaveBeenCalledWith(JOB_NAMES.AI_GENERATE_PRODUCT, { aiProductDataId: '123' });
      expect(result.jobId).toBe('job-123');
    });
  });

  describe('getGenerationStatus', () => {
    it('should return job status', async () => {
      mockJobRepo.findOne.mockResolvedValue({ id: 'job-123', status: AiGenerationJobStatus.COMPLETED });

      const result = await service.getGenerationStatus('123');

      expect(result.status).toBe(AiGenerationJobStatus.COMPLETED);
    });
  });
});
