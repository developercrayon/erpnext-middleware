/**
 * Abstract provider interface.
 * All concrete providers (OpenAI, Anthropic, Google) must implement this.
 */

export interface ContentGenerationInput {
  /** Product name provided by the user */
  itemName: string;
  /** Product description provided by the user */
  description: string;
  /** Optional reference image URL for vision-capable models */
  referenceImageUrl?: string;
  /** Optional reference image Base64 data for vision-capable models */
  referenceImageBase64?: string;
  /** System prompt from AI Settings */
  systemPrompt?: string;
  /** The specific model ID to use */
  model: string;
  /** Decrypted API key */
  apiKey: string;
  /** Decrypted API secret (if required, e.g. Google) */
  apiSecret?: string;
}

export interface ContentGenerationOutput {
  title: string;
  meta_title: string;
  meta_description: string;
  short_description: string;
  description: string;
  /** Optional array of feature/marketing bullet points for the product */
  bullet_points?: string[];
  /** Optional raw response from the AI provider */
  raw_response?: string;
}

export interface ImageGenerationInput {
  /** Text prompt describing the image */
  promptText: string;
  /** Optional reference image URL */
  referenceImageUrl?: string;
  /** Optional reference image Base64 data */
  referenceImageBase64?: string;
  /** Product name for context */
  itemName: string;
  /** The specific model ID to use */
  model: string;
  /** Decrypted API key */
  apiKey: string;
  /** Decrypted API secret (if required) */
  apiSecret?: string;
}

export interface ImageGenerationOutput {
  /** Base64-encoded image data */
  imageBase64: string;
  /** MIME type e.g. 'image/png' */
  mimeType: string;
}

/**
 * Abstract AI provider — all concrete providers must extend this class.
 */
export abstract class AIProvider {
  /**
   * Generate structured product content from user input.
   * Must return an object matching ContentGenerationOutput.
   */
  abstract generateContent(input: ContentGenerationInput): Promise<ContentGenerationOutput>;

  /**
   * Generate a product image from a text prompt.
   * Returns base64 image data + MIME type.
   * Must throw BadRequestException if the provider does not support image generation.
   */
  abstract generateImage(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}
