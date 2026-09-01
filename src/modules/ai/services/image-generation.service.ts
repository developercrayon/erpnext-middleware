import { Injectable, Logger } from '@nestjs/common';
import { AiProviderFactory } from '../providers/ai-provider.factory';
import { AiProviderName } from '../constants/ai-models.registry';
import { AiImagePrompt } from '../../../database/entities/ai.entity';
import * as fs from 'fs';
import * as path from 'path';

export interface GenerateImagesOptions {
  dataId: string; // The UUID of the AiProductData record
  itemName: string;
  prompts: AiImagePrompt[];
  referenceImageUrl?: string;
  referenceImageBase64?: string;
  config: {
    provider: AiProviderName;
    model: string;
    apiKey: string;
    apiSecret?: string;
  };
  onProgress?: (result: GeneratedImageResult, currentResults: GeneratedImageResult[]) => Promise<void>;
}

export interface GeneratedImageResult {
  filename: string;
  file_path: string;
  serve_url: string;
  mime_type: string;
  prompt_index: number;
  prompt_text: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class ImageGenerationService {
  private readonly logger = new Logger(ImageGenerationService.name);

  constructor(private readonly providerFactory: AiProviderFactory) {}

  async generateImages(options: GenerateImagesOptions): Promise<GeneratedImageResult[]> {
    const provider = this.providerFactory.getProvider(options.config.provider);
    const results: GeneratedImageResult[] = [];

    // Resolve public dir from current file location (dist/modules/ai/services) -> ../../../../public
    const publicDir = path.resolve(__dirname, '..', '..', '..', '..', 'public');
    const imagesDir = path.join(publicDir, 'generated_images', options.dataId);
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    for (let i = 0; i < options.prompts.length; i++) {
      const prompt = options.prompts[i];
      try {
        const response = await provider.generateImage({
          itemName: options.itemName,
          promptText: prompt.promptText,
          referenceImageUrl: options.referenceImageUrl,
          referenceImageBase64: options.referenceImageBase64,
          model: options.config.model,
          apiKey: options.config.apiKey,
          apiSecret: options.config.apiSecret,
        });

        // Determine file extension
        let ext = 'png';
        if (response.mimeType === 'image/jpeg') ext = 'jpg';
        if (response.mimeType === 'image/webp') ext = 'webp';

        const filename = `image-${i + 1}.${ext}`;
        const filePath = path.join(imagesDir, filename);

        // Write to disk
        fs.writeFileSync(filePath, Buffer.from(response.imageBase64, 'base64'));

        const result = {
          filename,
          file_path: filePath,
          serve_url: `/api/v1/ai/images/${options.dataId}/${i}`, // Used to stream from DB via API
          mime_type: response.mimeType,
          prompt_index: i,
          prompt_text: prompt.promptText,
          success: true,
        };
        results.push(result);
        if (options.onProgress) {
          await options.onProgress(result, [...results]);
        }
      } catch (error: any) {
        this.logger.error(`Failed to generate image for prompt ${i}: ${error.message}`);
        
        const result = {
          filename: '',
          file_path: '',
          serve_url: '',
          mime_type: '',
          prompt_index: i,
          prompt_text: prompt.promptText,
          success: false,
          error: error.message,
        };
        results.push(result);
        if (options.onProgress) {
          await options.onProgress(result, [...results]);
        }
      }
    }

    return results;
  }
}
