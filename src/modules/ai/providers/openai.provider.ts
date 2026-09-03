import { Injectable, BadRequestException } from '@nestjs/common';
import {
  AIProvider,
  ContentGenerationInput,
  ContentGenerationOutput,
  ImageGenerationInput,
  ImageGenerationOutput,
} from './ai-provider.interface';
import OpenAI from 'openai';

@Injectable()
export class OpenAiProvider extends AIProvider {
  async generateContent(
    input: ContentGenerationInput,
  ): Promise<ContentGenerationOutput> {
    const openai = new OpenAI({ apiKey: input.apiKey });

    const systemPrompt =
      input.systemPrompt ||
      'You are an expert ecommerce product copywriter. Output strictly valid JSON. Return ONLY the JSON object, with no markdown formatting or extra text.';

    const userMessage: any[] = [
      {
        type: 'text',
        text: `Product Name: ${input.itemName}\nDescription: ${input.description}`,
      },
    ];

    if (input.referenceImageUrl) {
      userMessage.push({
        type: 'image_url',
        image_url: { url: input.referenceImageUrl },
      });
    }

    try {
      const response = await openai.chat.completions.create({
        model: input.model || 'gpt-4o', // using standard openai model names as fallback
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
      });

      const contentString = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(contentString);

      return parsed as ContentGenerationOutput;
    } catch (error: any) {
      throw new Error(`OpenAI Content Generation failed: ${error.message}`);
    }
  }

  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationOutput> {
    const openai = new OpenAI({ apiKey: input.apiKey });

    try {
      const response = await openai.images.generate({
        model: input.model || 'dall-e-3', // fallback to dall-e-3
        prompt: `Product: ${input.itemName}. ${input.promptText}`,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json', // We need base64 to store in DB/disk directly
      });

      const base64Data = response.data[0]?.b64_json;

      if (!base64Data) {
        throw new Error('No base64 data returned from OpenAI');
      }

      return {
        imageBase64: base64Data,
        mimeType: 'image/png', // DALL-E returns PNG
      };
    } catch (error: any) {
      throw new Error(`OpenAI Image Generation failed: ${error.message}`);
    }
  }
}
