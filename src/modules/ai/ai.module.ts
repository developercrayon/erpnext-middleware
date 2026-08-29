import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { AiConfig, AiImagePrompt, AiProductData, AiGenerationJob, AiSocialMediaConfig } from '../../database/entities/ai.entity';
import { QUEUE_NAMES } from '../queue/queue.constants';

// Services
import { AiEncryptionService } from './services/ai-encryption.service';
import { AiModelService } from './services/ai-model.service';
import { AiSettingsService } from './services/ai-settings.service';
import { ContentGenerationService } from './services/content-generation.service';
import { ImageGenerationService } from './services/image-generation.service';
import { ProductAiService } from './services/product-ai.service';

// Providers
import { AiProviderFactory } from './providers/ai-provider.factory';
import { OpenAiProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GoogleProvider } from './providers/google.provider';
import { ScalemaxProvider } from './providers/scalemax.provider';

// Controllers
import { AiSettingsController } from './controllers/ai-settings.controller';
import { ProductAiController } from './controllers/product-ai.controller';

// Processors
import { AiGenerationProcessor } from './processors/ai-generation.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiConfig,
      AiImagePrompt,
      AiProductData,
      AiGenerationJob,
      AiSocialMediaConfig,
    ]),
    BullModule.registerQueue({
      name: QUEUE_NAMES.AI,
    }),
  ],
  controllers: [AiSettingsController, ProductAiController],
  providers: [
    AiEncryptionService,
    AiModelService,
    AiSettingsService,
    ContentGenerationService,
    ImageGenerationService,
    ProductAiService,
    AiProviderFactory,
    OpenAiProvider,
    AnthropicProvider,
    GoogleProvider,
    ScalemaxProvider,
    AiGenerationProcessor,
  ],
  exports: [ProductAiService, AiSettingsService, ContentGenerationService, ImageGenerationService],
})
export class AiModule {}
