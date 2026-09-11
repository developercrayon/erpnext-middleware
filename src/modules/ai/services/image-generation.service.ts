import { Injectable, Logger } from '@nestjs/common';
import { AiProviderFactory } from '../providers/ai-provider.factory';
import { AiProviderName } from '../constants/ai-models.registry';
import { AiImagePrompt } from '../../../database/entities/ai.entity';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

export interface GenerateImagesOptions {
  dataId: string;
  itemName: string;
  prompts: AiImagePrompt[];
  referenceImageUrl?: string;
  referenceImageBase64?: string;
  masterPrompt?: string;
  config: {
    provider: AiProviderName;
    model: string;
    apiKey: string;
    apiSecret?: string;
  };
  targetIndex?: number;
  existingResults?: GeneratedImageResult[];
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
    const results: GeneratedImageResult[] = options.existingResults ? [...options.existingResults] : [];

    const publicDir = path.join(process.cwd(), 'public');
    const imagesDir = path.join(publicDir, 'generated_images', options.dataId);
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const startIndex = options.targetIndex !== undefined ? options.targetIndex : 0;
    const endIndex = options.targetIndex !== undefined ? options.targetIndex + 1 : options.prompts.length;

    let resolvedReferenceImageBase64 = options.referenceImageBase64;
    if (!resolvedReferenceImageBase64 && options.referenceImageUrl && !options.referenceImageUrl.startsWith('blob:')) {
      try {
        let fullUrl = options.referenceImageUrl;
        if (!fullUrl.startsWith('http')) {
          const baseUrl = process.env.ERPNEXT_BASE_URL || 'http://localhost:8000';
          fullUrl = `${baseUrl}/${fullUrl.startsWith('/') ? fullUrl.substring(1) : fullUrl}`;
        }
        
        this.logger.log(`Fetching reference image from URL to convert to base64: ${fullUrl}`);
        const response = await axios.get(fullUrl, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        
        let mimeType = 'image/jpeg';
        if (fullUrl.toLowerCase().includes('.png')) mimeType = 'image/png';
        if (fullUrl.toLowerCase().includes('.webp')) mimeType = 'image/webp';
        
        resolvedReferenceImageBase64 = `data:${mimeType};base64,${base64}`;
        this.logger.log(`Successfully converted reference image to base64 on backend`);
      } catch (e: any) {
        this.logger.error(`Failed to convert reference image URL to base64: ${e.message}`);
      }
    }

    for (let i = startIndex; i < endIndex; i++) {
      const prompt = options.prompts[i];
      if (!prompt) continue;
      
      const finalPromptText = options.masterPrompt 
        ? `${options.masterPrompt}\n\n${prompt.promptText}` 
        : prompt.promptText;

      try {
        const response = await provider.generateImage({
          itemName: options.itemName,
          promptText: finalPromptText,
          referenceImageUrl: options.referenceImageUrl,
          referenceImageBase64: resolvedReferenceImageBase64,
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
          prompt_text: finalPromptText,
          success: true,
        };
        results[i] = result;
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
          prompt_text: finalPromptText,
          success: false,
          error: error.message,
        };
        results[i] = result;
        if (options.onProgress) {
          await options.onProgress(result, [...results]);
        }
      }
    }

    return results;
  }
}
