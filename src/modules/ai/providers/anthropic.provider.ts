import { Injectable, BadRequestException } from '@nestjs/common';
import {
  AIProvider,
  ContentGenerationInput,
  ContentGenerationOutput,
  ImageGenerationInput,
  ImageGenerationOutput,
} from './ai-provider.interface';
import Anthropic from '@anthropic-ai/sdk';

@Injectable()
export class AnthropicProvider extends AIProvider {
  async generateContent(
    input: ContentGenerationInput,
  ): Promise<ContentGenerationOutput> {
    const anthropic = new Anthropic({ apiKey: input.apiKey });

    const systemPrompt =
      input.systemPrompt ||
      'You are an expert ecommerce product copywriter. Output strictly valid JSON. Return ONLY the JSON object, with no markdown formatting or extra text.';

    const content: Array<any> = [
      {
        type: 'text',
        text: `Product Name: ${input.itemName}\nDescription: ${input.description}`,
      },
    ];

    if (input.referenceImageUrl) {
      // Anthropic requires base64 images, so if we only have a URL we'd need to fetch it first.
      // For this implementation, we assume if it's passed it's something we can use, 
      // but if we don't have base64, we might just append the URL to the text prompt.
      // To keep it robust, we'll just add it to the text since downloading it here is complex.
      content[0].text += `\nReference Image URL: ${input.referenceImageUrl}`;
    }

    try {
      const response = await anthropic.messages.create({
        model: input.model || 'claude-3-5-sonnet-latest',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      });

      const messageContent = response.content[0];
      let contentString = '';
      
      if (messageContent.type === 'text') {
         contentString = messageContent.text;
      }

      // Sometimes models wrap json in ```json ... ```
      const jsonMatch = contentString.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(contentString);

      return parsed as ContentGenerationOutput;
    } catch (error: any) {
      throw new Error(`Anthropic Content Generation failed: ${error.message}`);
    }
  }

  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationOutput> {
    throw new BadRequestException('Anthropic does not support image generation');
  }
}
