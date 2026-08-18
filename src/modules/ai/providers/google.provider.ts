import { Injectable } from '@nestjs/common';
import {
  AIProvider,
  ContentGenerationInput,
  ContentGenerationOutput,
  ImageGenerationInput,
  ImageGenerationOutput,
} from './ai-provider.interface';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class GoogleProvider extends AIProvider {
  private logToFile(type: 'response' | 'error', feature: 'content' | 'image', itemName: string, data: any) {
    try {
      const fs = require('fs');
      const path = require('path');
      const logsDir = path.join(process.cwd(), 'logs', 'ai-debug');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
      const safeItemName = itemName.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 30);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${feature}-${type}-${safeItemName}-${timestamp}.log`;

      const content = typeof data === 'string' ? data : (data instanceof Error ? data.stack || data.message : JSON.stringify(data, null, 2));
      fs.writeFileSync(path.join(logsDir, fileName), content, 'utf8');
    } catch (e) {
      console.error('Failed to write AI debug log', e);
    }
  }

  async generateContent(
    input: ContentGenerationInput,
  ): Promise<ContentGenerationOutput> {
    const ai = new GoogleGenAI({
      apiKey: input.apiKey,
    });

    const basePrompt = input.systemPrompt || 'You are an expert ecommerce product copywriter.';
    const systemPrompt = `${basePrompt}\n\nCRITICAL INSTRUCTION: You must strictly output valid JSON with ONLY these exact keys: "title", "meta_title", "meta_description", "short_description", "description".`;

    const modelName = input.model || 'gemini-3.5-flash-lite';

    const userPrompt = `Product Name: ${input.itemName}\nDescription: ${input.description}`;

    const promptParts: any[] = [userPrompt];

    if (input.referenceImageBase64) {
      // The frontend should send it as: data:image/jpeg;base64,/9j/...
      try {
        const matches = input.referenceImageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          promptParts.push({
            inlineData: {
              mimeType: matches[1],
              data: matches[2]
            }
          });
        }
      } catch (err) {
        console.error('Failed to parse referenceImageBase64', err);
      }
    } else if (input.referenceImageUrl) {
      promptParts.push(`\nReference Image URL: ${input.referenceImageUrl}`);
    }

    try {
      let result;
      let retries = 3;
      let delay = 1000;

      while (retries > 0) {
        try {
          result = await ai.models.generateContent({
            model: modelName,
            contents: promptParts,
            config: {
              systemInstruction: systemPrompt,
              responseMimeType: 'application/json',
            }
          });
          break; // Success
        } catch (err: any) {
          if ((err.message?.includes('503') || err.message?.includes('429')) && retries > 1) {
            retries--;
            await new Promise(res => setTimeout(res, delay));
            delay *= 2; // Exponential backoff
          } else {
            throw err;
          }
        }
      }

      const responseText = result.text;

      this.logToFile('response', 'content', input.itemName, responseText);

      const parsed = JSON.parse(responseText);

      return {
        title: parsed.title || parsed.item_title || input.itemName,
        meta_title: parsed.meta_title || parsed.item_metatitle || '',
        meta_description: parsed.meta_description || parsed.item_description || '',
        short_description: parsed.short_description || (parsed.item_bulletpoints ? parsed.item_bulletpoints.join('\n') : ''),
        description: parsed.description || parsed.item_description || '',
      };
    } catch (error: any) {
      this.logToFile('error', 'content', input.itemName, error);
      throw new Error(`Google Content Generation failed: ${error.message}`);
    }
  }

  async generateImage(
    input: ImageGenerationInput,
  ): Promise<ImageGenerationOutput> {
    const ai = new GoogleGenAI({
      apiKey: input.apiKey,
    });

    const promptText = `Product: ${input.itemName}. ${input.promptText}`;
    let aiInput: any = promptText;

    if (input.referenceImageBase64) {
      try {
        const matches = input.referenceImageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          aiInput = [
            { text: promptText },
            {
              inlineData: {
                mimeType: matches[1],
                data: matches[2]
              }
            }
          ];
        }
      } catch (err) {
        console.error('Failed to parse referenceImageBase64', err);
      }
    }

    let modelName = input.model || 'gemini-3.1-flash-image';

    try {
      let response;
      let retries = 3;
      let delay = 1000;

      while (retries > 0) {
        try {
          if (modelName.startsWith('imagen')) {
            response = await ai.models.generateImages({
              model: modelName,
              prompt: input.promptText,
              config: {
                numberOfImages: 1,
                outputMimeType: 'image/jpeg'
              }
            });
          } else {
            response = await ai.models.generateContent({
              model: modelName,
              contents: aiInput,
            });
          }
          break;
        } catch (err: any) {
          if ((err.message?.includes('503') || err.message?.includes('429')) && retries > 1) {
            retries--;
            await new Promise(res => setTimeout(res, delay));
            delay *= 2;
          } else {
            throw err;
          }
        }
      }

      if (!response) {
        throw new Error('No response from Google AI API');
      }

      // Check user's expected 'output_image' property first
      let imageBase64 = response.output_image || '';
      let mimeType = 'image/jpeg';

      // Fallback to checking candidates/outputs if standard format is returned
      if (!imageBase64 && response.outputs?.length > 0) {
        const out = response.outputs[0];
        if (out.inlineData?.data) {
          imageBase64 = out.inlineData.data;
          mimeType = out.inlineData.mimeType || mimeType;
        }
      }

      if (!imageBase64 && response.candidates?.length > 0) {
        const candidate = response.candidates[0];
        const inlineData = candidate?.content?.parts?.[0]?.inlineData;
        if (inlineData?.data) {
          imageBase64 = inlineData.data;
          mimeType = inlineData.mimeType || mimeType;
        }
      }

      if (!imageBase64 && response.generatedImages?.length > 0) {
        const genImg = response.generatedImages[0];
        if (genImg.image?.imageBytes) {
          imageBase64 = genImg.image.imageBytes;
          mimeType = genImg.image.mimeType || genImg.mimeType || mimeType;
        }
      }

      if (!imageBase64) {
        throw new Error('No base64 image returned in the response');
      }

      this.logToFile('response', 'image', input.itemName, { success: true, mimeType, length: imageBase64.length });

      return {
        imageBase64,
        mimeType,
      };
    } catch (error: any) {
      this.logToFile('error', 'image', input.itemName, error);
      throw new Error(`Google Image Generation failed: ${error.message}`);
    }
  }
}
