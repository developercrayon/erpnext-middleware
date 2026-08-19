import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { AIProvider, ContentGenerationInput, ContentGenerationOutput, ImageGenerationInput, ImageGenerationOutput } from './ai-provider.interface';

@Injectable()
export class ScalemaxProvider extends AIProvider {
  private readonly logger = new Logger(ScalemaxProvider.name);

  async generateContent(input: ContentGenerationInput): Promise<ContentGenerationOutput> {
    throw new BadRequestException('Scalemax provider does not support content generation yet');
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput> {
    try {
      const apiUrl = process.env.SCALEMAX_BASE_URL;
      if (!apiUrl) {
        throw new Error('SCALEMAX_BASE_URL is not defined in environment variables');
      }

      // We use input.promptText for the dynamic prompt
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model || 'gpt-image-2',
          prompt: input.promptText,
          n: 1,
          size: '1024x1024'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API Error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();

      if (data && data.data && data.data.length > 0) {
        const item = data.data[0];
        
        if (item.b64_json) {
          // The snippet converts it to data URL, but our interface requires raw base64
          // The image-generation.service.ts will handle saving it to disk
          this.logger.log("Image successfully generated using Scalemax!");
          return {
            imageBase64: item.b64_json,
            mimeType: 'image/png', // Assumption based on standard generation
          };
        }
      }
      
      throw new Error('Image data not found in response');
      
    } catch (error: any) {
      this.logger.error('Scalemax Image Generation failed:', error.message);
      throw new BadRequestException(`Scalemax image generation failed: ${error.message}`);
    }
  }
}
