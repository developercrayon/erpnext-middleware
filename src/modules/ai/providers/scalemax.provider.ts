import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { AIProvider, ContentGenerationInput, ContentGenerationOutput, ImageGenerationInput, ImageGenerationOutput } from './ai-provider.interface';
import axios from 'axios';

@Injectable()
export class ScalemaxProvider extends AIProvider {
  private readonly logger = new Logger(ScalemaxProvider.name);

  async generateContent(input: ContentGenerationInput): Promise<ContentGenerationOutput> {
    throw new BadRequestException('Scalemax provider does not support content generation yet');
  }

  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationOutput> {
    try {
      const apiUrl = process.env.SCALEMAX_BASE_URL;

      if (!apiUrl) {
        throw new Error(
          'SCALEMAX_BASE_URL is not defined in environment variables',
        );
      }

      const base64Data = input.referenceImageBase64
        ? input.referenceImageBase64.replace(
          /^data:image\/[^;]+;base64,/,
          '',
        )
        : undefined;

      const body: any = {
        model: input.model || 'gpt-image-2',
        prompt: input.promptText,
        n: 1,
        size: '1024x1024',
      };

      if (base64Data) {
        body.image = `data:image/png;base64,${base64Data}`;
      }

      this.logger.log(
        `Generating Scalemax image. Reference image: ${!!base64Data}`,
      );

      const response = await axios.post(apiUrl, body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
      });

      const data = response.data;

      if (data?.data?.length > 0) {
        const item = data.data[0];

        if (item.b64_json) {
          this.logger.log(
            'Image successfully generated using Scalemax!',
          );

          return {
            imageBase64: item.b64_json,
            mimeType: 'image/png',
          };
        }

        // Some APIs return a URL instead of b64_json
        if (item.url) {
          this.logger.log(
            'Scalemax returned an image URL instead of base64',
          );

          return {
            imageBase64: item.url,
            mimeType: 'image/png',
          };
        }
      }

      this.logger.error(
        'Unexpected Scalemax response:',
        JSON.stringify(data),
      );

      throw new Error('Image data not found in response');
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        'Unknown error';

      this.logger.error(
        'Scalemax Image Generation failed:',
        errorMessage,
      );

      if (error?.response?.data) {
        this.logger.error(
          'Scalemax error response:',
          JSON.stringify(error.response.data),
        );
      }

      throw new BadRequestException(
        `Scalemax image generation failed: ${errorMessage}`,
      );
    }
  }

}
