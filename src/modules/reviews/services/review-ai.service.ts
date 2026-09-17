import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AiSettingsService } from '../../ai/services/ai-settings.service';
import { AiConfigType } from '../../../database/entities/ai.entity';

import { ReviewSettingsService } from './review-settings.service';

export interface StructuredAiReviewOutput {
  sentiment: 'positive' | 'neutral' | 'negative';
  suggestedRating: number;
  title: string;
  review: string;
  topics: string[];
  followUpQuestion?: string;
}

export interface ReviewAnalysisOutput {
  sentiment: string;
  topics: string[];
  keywords: string[];
  summary: string;
  aspectRatings: {
    product_quality?: number;
    design?: number;
    durability?: number;
    packaging?: number;
    delivery?: number;
    value_for_money?: number;
    ease_of_use?: number;
  };
}

@Injectable()
export class ReviewAIService {
  private readonly logger = new Logger(ReviewAIService.name);

  constructor(
    private readonly aiSettingsService: AiSettingsService,
    private readonly settingsService: ReviewSettingsService,
  ) {}

  async polishCustomerReview(params: {
    productName: string;
    productCategory?: string;
    description?: string;
    rating: number;
    rawInput: string;
    spokenText?: string;
    uploadedPhotosCount?: number;
    conversationHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
  }): Promise<StructuredAiReviewOutput> {
    const combinedInput = [params.rawInput, params.spokenText].filter(Boolean).join(' ');

    const prompt = `You are an expert review editing assistant for "Woodwolff", an artisanal handcrafted wooden furniture & home goods brand.
A customer just left feedback for their purchased product.

Product Name: "${params.productName}"
Product Category: "${params.productCategory || 'Handcrafted Woodwork'}"
${params.description ? `Product Description & Materials: "${params.description}"` : ''}
Customer Rating: ${params.rating} / 5 stars
Customer Input (Typed / Spoken): "${combinedInput}"
${params.uploadedPhotosCount && params.uploadedPhotosCount > 0 ? `Customer Attached: ${params.uploadedPhotosCount} photo(s)/video(s) of the product in use.` : ''}
${
  params.conversationHistory && params.conversationHistory.length > 0
    ? `Prior Q&A History: ${JSON.stringify(params.conversationHistory)}`
    : ''
}

RULES:
1. PRESERVE MEANING: Do NOT invent facts or claim features not present. Respect the customer's exact tone and rating (${params.rating} stars).
2. Clean up grammar, fix all typos, eliminate stutters/fillers, improve flow and natural sentence structure.
3. Craft an engaging headline / title (maximum 8 words).
4. Extract 2-5 topics (e.g. "wood quality", "grain texture", "sturdiness", "design").
5. If input is short, suggest 1 relevant follow-up question; otherwise leave followUpQuestion empty.

OUTPUT MUST BE VALID JSON with this exact structure:
{
  "sentiment": "positive" | "neutral" | "negative",
  "suggestedRating": ${params.rating},
  "title": "Short headline here",
  "review": "Polished review content here",
  "topics": ["topic1", "topic2"],
  "followUpQuestion": "Optional thought question or empty string"
}`;

    let aiConfig;
    try {
      aiConfig = await this.aiSettingsService.getDecryptedConfig(AiConfigType.CONTENT);
    } catch (e) {
      this.logger.warn(`Could not get AI config: ${e.message}`);
    }

    // 2. Try OpenAI fallback
    if (aiConfig?.provider === 'openai') {
      try {
        const openaiClient = new OpenAI({ apiKey: aiConfig.apiKey });
        const res = await openaiClient.chat.completions.create({
          model: aiConfig.model || 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You format customer feedback into clean, honest reviews. Always output valid JSON.' },
            { role: 'user', content: prompt },
          ],
        });
        const text = res.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(text);
        if (parsed.review) {
          return {
            sentiment: parsed.sentiment || (params.rating >= 4 ? 'positive' : params.rating === 3 ? 'neutral' : 'negative'),
            suggestedRating: parsed.suggestedRating || params.rating,
            title: parsed.title || `${params.rating}-Star Experience with ${params.productName}`,
            review: parsed.review,
            topics: Array.isArray(parsed.topics) ? parsed.topics : ['quality'],
            followUpQuestion: parsed.followUpQuestion || undefined,
          };
        }
      } catch (err: any) {
        this.logger.warn(`OpenAI polish failed: ${err.message}`);
      }
    }

    // 3. Smart Heuristic Polish Fallback
    const cleanedText = this.applyHeuristicCleanup(combinedInput, params.productName);
    return {
      sentiment: params.rating >= 4 ? 'positive' : params.rating === 3 ? 'neutral' : 'negative',
      suggestedRating: params.rating,
      title: `${params.rating >= 4 ? 'Great Quality' : 'Experience with'} ${params.productName}`,
      review: cleanedText,
      topics: ['craftsmanship', 'quality'],
      followUpQuestion: combinedInput.length < 30 ? 'How does the wood finish look in your space?' : undefined,
    };
  }

  private applyHeuristicCleanup(input: string, productName: string): string {
    if (!input || !input.trim()) return `Really pleased with this ${productName}.`;
    let cleaned = input.trim();
    // Common typo fixes
    const typoMap: Record<string, string> = {
      '\\bpaked\\b': 'packaged',
      '\\beasyly\\b': 'easily',
      '\\beasylly\\b': 'easily',
      '\\batech\\b': 'attaches',
      '\\battech\\b': 'attaches',
      '\\bincress\\b': 'enhances',
      '\\bincrese\\b': 'enhances',
      '\\bgud\\b': 'good',
      '\\bnic\\b': 'nice',
      '\\bwoodn\\b': 'wooden',
    };
    for (const [pattern, replacement] of Object.entries(typoMap)) {
      cleaned = cleaned.replace(new RegExp(pattern, 'gi'), replacement);
    }
    // Capitalize first letter
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    if (!cleaned.endsWith('.') && !cleaned.endsWith('!') && !cleaned.endsWith('?')) {
      cleaned += '.';
    }
    return cleaned;
  }

  async generateProductSuggestions(params: {
    productName: string;
    productCategory?: string;
    rating: number;
    description?: string;
    userInput?: string;
    spokenText?: string;
    uploadedPhotosCount?: number;
  }): Promise<string[]> {
    const { productName, productCategory, rating = 5, description, userInput, spokenText, uploadedPhotosCount } = params;
    const customerNotes = [userInput, spokenText].filter(Boolean).join(' ');

    const prompt = `Generate 3 fresh, natural, distinct 1-sentence customer review starter suggestions for:
Product: "${productName}"
Category: "${productCategory || 'Wooden Furniture / Decor'}"
${description ? `Item Details & Materials: "${description}"` : ''}
Rating: ${rating} / 5 stars
${customerNotes ? `Customer Initial Thoughts/Words: "${customerNotes}"` : ''}
${uploadedPhotosCount && uploadedPhotosCount > 0 ? `Customer uploaded ${uploadedPhotosCount} photo(s) of the product.` : ''}

Context: The review ideas should match the customer's ${rating}-star sentiment, naturally integrate any specific details from the item description (wood type, finish, size, usage) and their initial thoughts if present. They must sound like genuine, authentic buyers.

Return valid JSON array of 3 distinct strings. Example: ["The wood grain and smooth finish look stunning on my dining table.", "Very sturdy build and arrived in protective packaging.", "Fits perfectly in my room and feels like true artisan woodwork."]`;

    let aiConfig;
    try {
      aiConfig = await this.aiSettingsService.getDecryptedConfig(AiConfigType.CONTENT);
    } catch (e) {}

    if (aiConfig?.provider === 'openai') {
      try {
        const openaiClient = new OpenAI({ apiKey: aiConfig.apiKey });
        const res = await openaiClient.chat.completions.create({
          model: aiConfig.model || 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Generate natural review starters. Return JSON array under key "suggestions".' },
            { role: 'user', content: prompt },
          ],
        });
        const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
        const list = Array.isArray(parsed) ? parsed : parsed.suggestions;
        if (Array.isArray(list) && list.length > 0) return list.slice(0, 3);
      } catch (e) {}
    }

    // Dynamic Context-aware Fallback
    const descHighlight = description ? description.split('.')[0] : '';
    const seed = Math.floor(Math.random() * 3);

    if (rating >= 4.5) {
      const options = [
        [
          `The craftsmanship of this ${productName} is incredible and it looks stunning in our home.`,
          `Very sturdy, ${descHighlight ? `featuring ${descHighlight.toLowerCase()}` : 'holds securely'}, and exceeded my expectations.`,
          `Such a beautiful and rustic woodwork piece that gets compliments from everyone!`,
        ],
        [
          `The natural wood finish and handcrafted quality of this ${productName} are top tier.`,
          `Solid premium feel with authentic wood grain texture — perfectly sized for everyday use.`,
          `Arrived impeccably packaged and looks even better in person than in photos!`,
        ],
      ];
      return options[seed % options.length];
    } else if (rating >= 3.5) {
      return [
        `The ${productName} looks nice in person, though the wood color is slightly lighter than expected.`,
        `Decent quality and sturdy enough for daily use, reasonably priced for handcrafted woodwork.`,
        `Functional and well-made overall, took a bit of time to place but looks good in the space.`,
      ];
    } else {
      return [
        `The ${productName} did not meet expectations regarding build sturdiness and wood finish.`,
        `Experienced issues with fit and finish right out of the packaging.`,
        `Would appreciate better quality inspection and smoother joinery on this piece.`,
      ];
    }
  }

  async polishOverallExperience(params: {
    rawInput?: string;
    rating?: number;
    spokenText?: string;
    productReviews?: Array<{
      productName: string;
      productCategory?: string;
      rating: number;
      reviewText?: string;
      spokenText?: string;
      uploadedPhotosCount?: number;
      hasPhotos?: boolean;
    }>;
  }): Promise<{
    title: string;
    review: string;
    quickSuggestions: string[];
    drafts: Array<{ id: string; tag: string; title: string; text: string }>;
  }> {
    const rawInput = [params.rawInput, params.spokenText].filter(Boolean).join(' ');
    const rating = params.rating || 5;
    const itemsSummary = (params.productReviews || [])
      .map(
        (p, idx) =>
          `Item ${idx + 1}: "${p.productName}" (Category: ${p.productCategory || 'Woodwork'}, Rating: ${p.rating}/5 stars)
- Customer Review: "${p.reviewText || p.spokenText || 'Rated ' + p.rating + ' stars'}"
- Photos: ${p.uploadedPhotosCount || (p.hasPhotos ? 1 : 0)} photo(s) uploaded`,
      )
      .join('\n\n');

    const settings = this.settingsService.getSettings();
    const draftsCount = Math.min(10, Math.max(1, settings.aiDraftsCount || 4));

    const prompt = `You are the AI review assistant for "Woodwolff", a premium artisan handcrafted woodwork & furniture brand.
Brand Tone: ${settings.brandTone || 'Artisanal & Warm'}.
Synthesize a comprehensive, authentic customer overall order review that combines ALL aspects of their purchase:
- Products purchased and individual ratings/feedback
- Attached photos / visual evidence
- Unboxing experience and transit packaging protection
- Delivery speed and courier handling
- Customer voice/typed notes: "${rawInput}"
- Overall satisfaction rating: ${rating} / 5 stars

Individual Product Reviews in this Order:
${itemsSummary || 'Handcrafted Woodwolff collection'}

Generate EXACTLY ${draftsCount} distinct, high-quality, authentic review drafts with different focuses and tones (e.g. holistic experience, craftsmanship & wood grain, unboxing & delivery care, concise summary, home styling).

Also provide ${draftsCount} short 1-line quick bullet suggestions.

OUTPUT FORMAT MUST BE STRICT JSON:
{
  "title": "Short captivating order headline",
  "review": "Primary holistic review text",
  "quickSuggestions": [
    "Quick idea 1",
    "Quick idea 2"
  ],
  "drafts": [
    {
      "id": "draft_1",
      "tag": "Complete Order Experience",
      "title": "Comprehensive Experience",
      "text": "..."
    }
  ]
}

Do NOT use any emojis in the tags, titles, or review texts. Use pure professional text and symbols only.`;

    let aiConfig;
    try {
      aiConfig = await this.aiSettingsService.getDecryptedConfig(AiConfigType.CONTENT);
    } catch (e) {}

    const fallbackDrafts = this.getDefaultOverallDrafts(rating, params.productReviews).slice(0, draftsCount);
    return {
      title: 'Seamless Delivery & Handcrafted Excellence',
      review: rawInput.trim() || fallbackDrafts[0]?.text || 'Prompt delivery with eco-friendly, secure packaging and outstanding craftsmanship.',
      quickSuggestions: this.getDefaultQuickSuggestions(rating).slice(0, draftsCount),
      drafts: fallbackDrafts,
    };
  }

  private getDefaultQuickSuggestions(rating: number): string[] {
    if (rating >= 4.5) {
      return [
        'Eco-friendly, damage-free packaging and prompt delivery.',
        'Flawless craftsmanship, authentic wood aroma, and arrived right on schedule.',
        'Top-notch customer support and high attention to detail in packaging.',
        'Every single piece exceeded expectations in build quality.',
        'Looks even more beautiful in my home than in the product photos.',
      ];
    } else if (rating >= 3.5) {
      return [
        'Decent packaging and arrived in good condition within expected timeframe.',
        'Satisfactory order experience with authentic handcrafted wood feel.',
        'Good value for money and fits well in our living space.',
        'Packaging was secure, though dispatch could be a bit faster.',
        'Overall pleasant shopping experience for handcrafted wooden decor.',
      ];
    } else {
      return [
        'Packaging needs reinforcement to prevent minor handling marks.',
        'Delivery took longer than anticipated.',
        'Customer support could be more proactive regarding order tracking.',
        'Items arrived safely but finish requires better consistency.',
        'Hope to see improved shipping speed on future orders.',
      ];
    }
  }

  private getDefaultOverallDrafts(
    rating: number,
    productReviews?: Array<{ productName: string; rating: number; reviewText?: string }>,
  ): Array<{ id: string; tag: string; title: string; text: string }> {
    const firstProd = productReviews?.[0]?.productName || 'handcrafted wood pieces';
    const totalCount = productReviews?.length || 1;
    const countText = totalCount > 1 ? `all ${totalCount} items in my order` : `my ${firstProd}`;

    if (rating >= 4.5) {
      return [
        {
          id: 'holistic',
          tag: 'Complete Order Experience',
          title: 'Comprehensive Experience',
          text: `Ordering from Woodwolff was a wonderful experience from checkout to delivery. The package arrived on schedule, wrapped with exceptional multi-layered protective materials. Unboxing ${countText} was truly satisfying — the craftsmanship is top-tier and they look spectacular in my home.`,
        },
        {
          id: 'craftsmanship',
          tag: 'Craftsmanship & Finish',
          title: 'Artisan Wood Quality',
          text: `The authentic solid wood quality across ${countText} is immediately evident. You can feel the rich grain and smooth, natural matt polish. It's rare to find such authentic artisanal woodwork at this level of finish.`,
        },
        {
          id: 'unboxing',
          tag: 'Packaging & Delivery',
          title: 'Safe & Secure Transit',
          text: `Extremely impressed with the shipping care! The parcel arrived without a single scratch or dent, packed with robust eco-friendly cushioning. The pleasant natural wood scent upon unboxing made the arrival even more special.`,
        },
        {
          id: 'concise',
          tag: 'Quick & Punchy',
          title: 'Short Summary',
          text: `Fast delivery, bulletproof packaging, and breathtaking artisan woodwork. Woodwolff sets the benchmark for premium home furniture.`,
        },
        {
          id: 'styling',
          tag: 'Home Decor & Styling',
          title: 'Aesthetic Appeal',
          text: `${countText.charAt(0).toUpperCase() + countText.slice(1)} elevated our interior decor instantly. The organic wood tones blend seamlessly with our space, and the actual items look even better than the catalog pictures. Highly recommended!`,
        },
      ];
    } else {
      return [
        {
          id: 'holistic',
          tag: 'Overall Feedback',
          title: 'Balanced Experience',
          text: `My order for ${countText} arrived safely. The delivery packaging was adequate and protected the items during transit, though there is room for refinement in wood finishing.`,
        },
        {
          id: 'craftsmanship',
          tag: 'Material & Build',
          title: 'Craftsmanship Note',
          text: `The solid wood base is functional and serves its purpose, though the surface finish and color tones could be more uniform across the piece.`,
        },
        {
          id: 'unboxing',
          tag: 'Packaging & Transit',
          title: 'Shipping & Delivery',
          text: `Delivery was completed within reasonable time, and the outer box was intact. Unboxing was straightforward with standard protective wrapping.`,
        },
        {
          id: 'concise',
          tag: 'Brief Summary',
          title: 'Summary',
          text: `Fair shopping experience. Items arrived safely, though with minor improvements needed in dispatch tracking and final finish.`,
        },
        {
          id: 'styling',
          tag: 'Practical Usage',
          title: 'Everyday Utility',
          text: `The items are functional for daily household use and offer decent practicality for the price point.`,
        },
      ];
    }
  }

  async analyzeSubmittedReview(reviewText: string, rating: number, productName: string): Promise<ReviewAnalysisOutput> {
    const prompt = `Analyze this Woodwolff customer review.
Product: ${productName}
Rating: ${rating} / 5
Review Text: "${reviewText}"

Extract structured review analytics.
OUTPUT MUST BE VALID JSON:
{
  "sentiment": "positive" | "neutral" | "negative",
  "topics": ["string"],
  "keywords": ["string"],
  "summary": "1 sentence executive summary",
  "aspectRatings": {
    "product_quality": 1-5,
    "design": 1-5,
    "durability": 1-5,
    "packaging": 1-5,
    "delivery": 1-5,
    "value_for_money": 1-5,
    "ease_of_use": 1-5
  }
}`;

    let aiConfig;
    try {
      aiConfig = await this.aiSettingsService.getDecryptedConfig(AiConfigType.CONTENT);
    } catch (e) {}

    return {
      sentiment: rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative',
      topics: ['woodwork', 'home'],
      keywords: reviewText.toLowerCase().split(/\s+/).filter((w) => w.length > 4).slice(0, 5),
      summary: reviewText.slice(0, 120),
      aspectRatings: {
        product_quality: rating,
        design: rating,
      },
    };
  }
}
