import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import { AiSettingsService } from '../../../common/services/ai-settings.service';
import { AiConfigType } from '../../../database/entities/ai.entity';
import { ErpItem } from '../../../database/entities/erp-item.entity';
import { ErpCustomer } from '../../../database/entities/erp-customer.entity';
import { ChatMessage } from '../dto/chat-order-prompt.dto';
import * as fs from 'fs';
import * as path from 'path';

export interface StructuredAiOrderOutput {
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  customer_gstin?: string;
  billing_address?: string;
  shipping_address?: string;
  order_date?: string;
  delivery_date?: string;
  po_no?: string;
  currency: string;
  items: Array<{
    item_code: string;
    item_name: string;
    description?: string;
    hsn_code?: string;
    qty: number;
    uom: string;
    rate: number;
    discount_percentage?: number;
    discount_amount?: number;
    tax_percentage?: number;
    warehouse?: string;
  }>;
  document_grand_total?: number;
  document_taxable_amount?: number;
  document_tax_amount?: number;
  ai_reply?: string;
}

@Injectable()
export class SalesOrderAiService {
  private readonly logger = new Logger(SalesOrderAiService.name);

  constructor(
    private readonly aiSettingsService: AiSettingsService,
    @InjectRepository(ErpItem)
    private readonly itemRepo: Repository<ErpItem>,
    @InjectRepository(ErpCustomer)
    private readonly customerRepo: Repository<ErpCustomer>,
  ) {}

  /**
   * Conversational Chatboard AI for generating or updating Sales Orders
   */
  async processChatOrder(params: {
    message: string;
    conversationHistory?: ChatMessage[];
    currentOrderDraft?: any;
  }): Promise<{ reply: string; orderDraft: StructuredAiOrderOutput }> {
    const { message, conversationHistory = [], currentOrderDraft } = params;

    // Get catalog context for matching
    const catalogItems = await this.itemRepo.find({ take: 50 });
    const catalogContext = catalogItems
      .map((i) => `- Code: "${i.item_code}", Name: "${i.item_name}", Rate: ₹${i.standard_rate || 0}, HSN: "${i.gst_hsn_code || ''}"`)
      .join('\n');

    const systemPrompt = `You are the AI Sales Order Assistant for "Woodwolf Studio", an artisan furniture & woodwork brand.
Your job is to assist sales representatives in creating, updating, or modifying Sales Orders from natural language chat.

CURRENT ERP PRODUCT CATALOG:
${catalogContext || '- PROD-MUG-RACK: Handcrafted Wooden Mug Rack, ₹1850\n- PROD-WALL-SHELF: Minimalist Wooden Wall Shelf, ₹3200\n- PROD-TRAY-SET: Artisan Acacia Serving Tray, ₹2450\n- PROD-COFFEE-TABLE: Rustic Teak Coffee Table, ₹14500'}

EXISTING ORDER DRAFT (if any):
${currentOrderDraft ? JSON.stringify(currentOrderDraft, null, 2) : 'None (Starting new order)'}

RULES:
1. Match requested products against the catalog. Use exact item_code and standard rates when available.
2. If user mentions discounts (e.g. "give 10% off on shelves"), calculate or set discount_percentage.
3. If user mentions customer details (Name, phone, address), populate them.
4. If currentOrderDraft exists, merge and update items intelligently.
5. In your "reply", give a friendly, concise summary of what was added or updated.

RETURN STRICT JSON conforming to this format:
{
  "reply": "Friendly response explaining what was added/updated",
  "orderDraft": {
    "customer_name": "Customer Name",
    "customer_email": "Email or null",
    "customer_phone": "Phone or null",
    "customer_gstin": "GSTIN or null",
    "billing_address": "Address or null",
    "shipping_address": "Address or null",
    "order_date": "YYYY-MM-DD",
    "delivery_date": "YYYY-MM-DD",
    "po_no": "PO Number or null",
    "currency": "INR",
    "items": [
      {
        "item_code": "PROD-MUG-RACK",
        "item_name": "Handcrafted Wooden Mug Rack",
        "description": "Solid natural teak wood mug tree rack",
        "hsn_code": "44201000",
        "qty": 2,
        "uom": "Nos",
        "rate": 1850.0,
        "discount_percentage": 0,
        "discount_amount": 0,
        "tax_percentage": 18,
        "warehouse": "Stores - woodwolf"
      }
    ]
  }
}`;

    const userPrompt = `User message: "${message}"\n\nPlease process this request and return structured JSON.`;

    // 1. Try ScaleMax Claude if configured
    let imgAiConfig;
    try {
      imgAiConfig = await this.aiSettingsService.getDecryptedConfig(AiConfigType.IMAGE);
    } catch (e) {}

    if (imgAiConfig?.apiKey && imgAiConfig.provider === 'scalemax') {
      const candidateModels = ['claude-opus-5', 'claude-sonnet-5', 'gpt-5.4-mini'];
      for (const smModel of candidateModels) {
        try {
          const baseUrl = imgAiConfig.url || process.env.SCALEMAX_BASE_URL || 'https://api.scalemax.pro/v1';
          const apiUrl = imgAiConfig.readUrl || (baseUrl.endsWith('/') ? `${baseUrl}messages` : `${baseUrl}/messages`);
          const smRes = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${imgAiConfig.apiKey}` },
            body: JSON.stringify({
              model: smModel,
              max_tokens: 2048,
              system: `${systemPrompt}\n\nCRITICAL: Return strictly valid JSON with no preamble.`,
              messages: [{ role: 'user', content: userPrompt }],
            }),
          });
          if (smRes.ok) {
            const resJson: any = await smRes.json();
            const contentArr = resJson?.content || [];
            const textBlock = contentArr.find((c: any) => c.type === 'text') || contentArr[0];
            const parsed = this.parseJsonResponse(textBlock?.text || '{}');
            if (parsed && (parsed.customer_name || (parsed.items && parsed.items.length > 0))) {
              return {
                reply: parsed.ai_reply || 'Updated order draft based on your chat message.',
                orderDraft: this.sanitizeOrderOutput(parsed),
              };
            }
          }
        } catch (smErr: any) {
          this.logger.warn(`ScaleMax Chat Order (${smModel}) failed: ${smErr.message}`);
        }
      }
    }

    // 2. Try Google Gemini if configured
    let contentAiConfig;
    try {
      contentAiConfig = await this.aiSettingsService.getDecryptedConfig(AiConfigType.CONTENT);
    } catch (e) {}

    if (contentAiConfig?.apiKey && contentAiConfig.provider === 'google') {
      const candidateModels = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
      for (const model of candidateModels) {
        try {
          const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${contentAiConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ parts: [{ text: userPrompt }] }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          });
          if (gRes.ok) {
            const data = await gRes.json();
            const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawText) {
              const parsed = JSON.parse(rawText);
              if (parsed.orderDraft) {
                return {
                  reply: parsed.reply || 'I have prepared your sales order draft.',
                  orderDraft: this.sanitizeOrderOutput(parsed.orderDraft),
                };
              }
            }
          }
        } catch (gErr: any) {
          this.logger.warn(`Google Chat Order (${model}) failed: ${gErr.message}`);
        }
      }
    }

    // 3. Try OpenAI
    if (contentAiConfig?.apiKey && contentAiConfig.provider === 'openai') {
      try {
        const openai = new OpenAI({ apiKey: contentAiConfig.apiKey });
        const res = await openai.chat.completions.create({
          model: contentAiConfig.model || 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userPrompt },
          ],
        });
        const parsed = JSON.parse(res.choices[0]?.message?.content || '{}');
        if (parsed.orderDraft) {
          return {
            reply: parsed.reply || 'I have prepared your sales order draft.',
            orderDraft: this.sanitizeOrderOutput(parsed.orderDraft),
          };
        }
      } catch (err: any) {
        this.logger.warn(`OpenAI Chat Order failed: ${err.message}`);
      }
    }

    // Heuristic Fallback
    const fallbackDraft = this.buildHeuristicOrderDraft(message, catalogItems, currentOrderDraft);
    return {
      reply: `Draft order updated with ${fallbackDraft.items.length} items based on your instructions.`,
      orderDraft: fallbackDraft,
    };
  }

  /**
   * Voice AI Speech-to-Order processor
   */
  async processVoiceOrder(params: {
    spokenText?: string;
    customerName?: string;
    currentOrderDraft?: any;
  }): Promise<{ reply: string; orderDraft: StructuredAiOrderOutput }> {
    const text = (params.spokenText || '').trim();
    if (!text) {
      throw new Error('No spoken text provided for Voice Order processing.');
    }
    return this.processChatOrder({
      message: `[VOICE INPUT] ${text} ${params.customerName ? `for customer ${params.customerName}` : ''}`,
      currentOrderDraft: params.currentOrderDraft,
    });
  }

  /**
   * Customer PO Document Multi-AI Extractor (PDF, Images JPG/PNG/WebP, Word DOC/DOCX)
   */
  async extractFromPoDocument(filePath: string, originalFileName: string): Promise<StructuredAiOrderOutput> {
    const ext = path.extname(originalFileName || filePath).toLowerCase();
    const isWordDoc = ext === '.doc' || ext === '.docx';
    const isPdf = ext === '.pdf';

    this.logger.log(`Starting PO document extraction for: ${originalFileName} (${ext})`);

    // 1. If Word document (.doc / .docx), extract text directly
    if (isWordDoc) {
      try {
        const wordText = await this.extractWordDocText(filePath);
        if (wordText && wordText.trim().length > 20) {
          this.logger.log(`Extracted text from Word document (${wordText.length} chars). Routing to AI text parser...`);
          const parsed = await this.extractFromPoDocumentText(wordText);
          if (parsed && (parsed.customer_name || (parsed.items && parsed.items.length > 0))) {
            return this.sanitizeOrderOutput(parsed);
          }
        }
      } catch (wordErr: any) {
        this.logger.warn(`Word text extraction failed: ${wordErr.message}. Cascading...`);
      }
    }

    // 2. If PDF, try native text layer first for 100% precision
    if (isPdf) {
      try {
        const pdfText = await this.extractPdfText(filePath);
        if (pdfText && pdfText.trim().length > 30) {
          this.logger.log(`Extracted digital text from PDF (${pdfText.length} chars). Routing to AI text parser...`);
          const parsed = await this.extractFromPoDocumentText(pdfText);
          if (parsed && (parsed.customer_name || (parsed.items && parsed.items.length > 0))) {
            return this.sanitizeOrderOutput(parsed);
          }
        }
      } catch (pdfErr: any) {
        this.logger.warn(`Digital PDF text extraction failed: ${pdfErr.message}. Falling back to Vision AI pipeline...`);
      }
    }

    // 3. Vision AI pipeline (ScaleMax Claude / Google Gemini Vision / OpenAI Vision)
    let aiConfigImage;
    let aiConfigContent;
    try {
      aiConfigImage = await this.aiSettingsService.getDecryptedConfig(AiConfigType.IMAGE);
    } catch (e) {}
    try {
      aiConfigContent = await this.aiSettingsService.getDecryptedConfig(AiConfigType.CONTENT);
    } catch (e) {}

    const errors: string[] = [];

    // Try ScaleMax Claude Vision first
    const scalemaxConfig = aiConfigImage?.provider === 'scalemax' ? aiConfigImage : (aiConfigContent?.provider === 'scalemax' ? aiConfigContent : null);
    if (scalemaxConfig?.apiKey) {
      try {
        this.logger.log('Attempting PO Vision Extraction via ScaleMax Claude API...');
        const result = await this.extractWithScaleMaxClaude(filePath, originalFileName, scalemaxConfig);
        if (result && (result.customer_name || (result.items && result.items.length > 0))) {
          return this.sanitizeOrderOutput(result);
        }
      } catch (smErr: any) {
        this.logger.warn(`ScaleMax Claude PO extraction failed: ${smErr.message}. Cascading...`);
        errors.push(`ScaleMax: ${smErr.message}`);
      }
    }

    // Try Google Gemini Vision
    const googleConfig = aiConfigContent?.provider === 'google' ? aiConfigContent : (aiConfigImage?.provider === 'google' ? aiConfigImage : null);
    if (googleConfig?.apiKey) {
      try {
        this.logger.log('Attempting PO Vision Extraction via Google Gemini Vision API...');
        const result = await this.extractWithGoogleGeminiVision(filePath, originalFileName, googleConfig);
        if (result && (result.customer_name || (result.items && result.items.length > 0))) {
          return this.sanitizeOrderOutput(result);
        }
      } catch (gErr: any) {
        this.logger.warn(`Google Gemini Vision PO extraction failed: ${gErr.message}. Cascading...`);
        errors.push(`Google: ${gErr.message}`);
      }
    }

    // Try OpenAI Vision
    const openaiConfig = aiConfigImage?.provider === 'openai' ? aiConfigImage : (aiConfigContent?.provider === 'openai' ? aiConfigContent : null);
    if (openaiConfig?.apiKey) {
      try {
        this.logger.log('Attempting PO Vision Extraction via OpenAI API...');
        const result = await this.extractWithOpenAIVision(filePath, originalFileName, openaiConfig);
        if (result && (result.customer_name || (result.items && result.items.length > 0))) {
          return this.sanitizeOrderOutput(result);
        }
      } catch (oaErr: any) {
        this.logger.warn(`OpenAI PO Vision extraction failed: ${oaErr.message}`);
        errors.push(`OpenAI: ${oaErr.message}`);
      }
    }

    // 4. Fallback parser
    this.logger.warn(`AI extraction encountered errors (${errors.join(' | ')}). Using local parser fallback.`);
    const catalog = await this.itemRepo.find({ take: 30 });
    return this.buildHeuristicOrderDraft(originalFileName || 'PO Order', catalog);
  }

  private async extractWordDocText(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.docx') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mammoth = require('mammoth');
      const res = await mammoth.extractRawText({ path: filePath });
      return res?.value || '';
    } else if (ext === '.doc') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const WordExtractor = require('word-extractor');
      const extractor = new WordExtractor();
      const extracted = await extractor.extract(filePath);
      return extracted.getBody() || '';
    }
    return '';
  }

  private async extractPdfText(filePath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(filePath);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PDFParse, VerbosityLevel } = require('pdf-parse');
    const parser = new PDFParse({
      verbosity: VerbosityLevel ? VerbosityLevel.ERRORS : 0,
      data: dataBuffer,
    });
    await parser.load();
    const res = await parser.getText();
    return res?.text || '';
  }

  private async extractFromPoDocumentText(docText: string): Promise<StructuredAiOrderOutput> {
    let aiConfigContent;
    let aiConfigImage;
    try {
      aiConfigContent = await this.aiSettingsService.getDecryptedConfig(AiConfigType.CONTENT);
    } catch (e) {}
    try {
      aiConfigImage = await this.aiSettingsService.getDecryptedConfig(AiConfigType.IMAGE);
    } catch (e) {}

    const systemPrompt = this.getPoExtractionPrompt();
    const errors: string[] = [];

    // 1. ScaleMax Claude Text Extraction (Highest accuracy for multi-row tables and invoices)
    const scalemaxConfig = aiConfigImage?.provider === 'scalemax' ? aiConfigImage : (aiConfigContent?.provider === 'scalemax' ? aiConfigContent : null);
    if (scalemaxConfig?.apiKey) {
      const baseUrl = scalemaxConfig.url || process.env.SCALEMAX_BASE_URL || 'https://api.scalemax.pro/v1';
      const apiUrl = scalemaxConfig.readUrl || (baseUrl.endsWith('/') ? `${baseUrl}messages` : `${baseUrl}/messages`);
      const candidateModels = ['claude-opus-5', 'claude-sonnet-5', 'gpt-5.4-mini'];

      for (const smModel of candidateModels) {
        try {
          const payload = {
            model: smModel,
            max_tokens: 2048,
            system: `${systemPrompt}\n\nCRITICAL: Return ONLY valid, parseable JSON with no conversational text.`,
            messages: [
              { role: 'user', content: `Extract customer purchase order details from this document text:\n\n${docText}` },
            ],
          };
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${scalemaxConfig.apiKey}` },
            body: JSON.stringify(payload),
          });
          if (response.ok) {
            const resJson: any = await response.json();
            const contentArr = resJson?.content || [];
            const textBlock = contentArr.find((c: any) => c.type === 'text') || contentArr[0];
            const parsed = this.parseJsonResponse(textBlock?.text || '{}');
            if (parsed && (parsed.customer_name || (parsed.items && parsed.items.length > 0))) {
              return this.sanitizeOrderOutput(parsed);
            }
          } else {
            const errBody = await response.text();
            errors.push(`ScaleMax (${smModel}): HTTP ${response.status} - ${errBody.slice(0, 100)}`);
          }
        } catch (smErr: any) {
          errors.push(`ScaleMax (${smModel}): ${smErr.message}`);
        }
      }
    }

    // 2. Google Gemini Text Extraction
    const googleConfig = aiConfigContent?.provider === 'google' ? aiConfigContent : (aiConfigImage?.provider === 'google' ? aiConfigImage : null);
    if (googleConfig?.apiKey) {
      const candidateModels = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
      for (const model of candidateModels) {
        try {
          const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${googleConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ parts: [{ text: `Extract customer purchase order details from this document text:\n\n${docText}` }] }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          });
          if (gRes.ok) {
            const data = await gRes.json();
            const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawText) {
              const parsed = this.parseJsonResponse(rawText);
              if (parsed && (parsed.customer_name || (parsed.items && parsed.items.length > 0))) {
                return this.sanitizeOrderOutput(parsed);
              }
            }
          } else {
            const errBody = await gRes.text();
            errors.push(`Google (${model}): HTTP ${gRes.status} - ${errBody.slice(0, 100)}`);
          }
        } catch (gErr: any) {
          errors.push(`Google (${model}): ${gErr.message}`);
        }
      }
    }

    // 3. OpenAI Text Extraction
    const openaiConfig = aiConfigImage?.provider === 'openai' ? aiConfigImage : (aiConfigContent?.provider === 'openai' ? aiConfigContent : null);
    if (openaiConfig?.apiKey) {
      try {
        const openai = new OpenAI({ apiKey: openaiConfig.apiKey });
        const res = await openai.chat.completions.create({
          model: openaiConfig.readModel || openaiConfig.model || 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Extract customer purchase order details from this document text:\n\n${docText}` },
          ],
          response_format: { type: 'json_object' },
        });
        const raw = res.choices[0]?.message?.content || '{}';
        const parsed = this.parseJsonResponse(raw);
        return this.sanitizeOrderOutput(parsed);
      } catch (oaErr: any) {
        errors.push(`OpenAI: ${oaErr.message}`);
      }
    }

    // 4. Local Heuristic Parser for text
    const catalog = await this.itemRepo.find({ take: 30 });
    return this.buildHeuristicOrderDraft(docText, catalog);
  }

  private async extractWithGoogleGeminiVision(filePath: string, originalFileName: string, aiConfig: any): Promise<StructuredAiOrderOutput> {
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const ext = path.extname(originalFileName || filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.pdf' ? 'application/pdf' : 'image/jpeg';

    const candidateModels = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
    let lastError: any = null;

    for (const model of candidateModels) {
      try {
        const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${aiConfig.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: this.getPoExtractionPrompt() }] },
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: base64Data,
                    },
                  },
                  {
                    text: 'Extract all customer PO details and item table from this document strictly into JSON conforming to the schema.',
                  },
                ],
              },
            ],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        });

        if (!gRes.ok) {
          const errText = await gRes.text();
          throw new Error(`Google Vision HTTP ${gRes.status}: ${errText.slice(0, 150)}`);
        }

        const data = await gRes.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          return this.parseJsonResponse(rawText);
        }
      } catch (err: any) {
        lastError = err;
        this.logger.warn(`Google Vision (${model}) failed: ${err.message}`);
      }
    }

    throw lastError || new Error('Google Gemini Vision extraction failed across all models.');
  }

  private async extractWithScaleMaxClaude(filePath: string, originalFileName: string, aiConfig: any): Promise<StructuredAiOrderOutput> {
    const baseUrl = aiConfig.url || process.env.SCALEMAX_BASE_URL || 'https://api.scalemax.pro/v1';
    const apiUrl = aiConfig.readUrl || (baseUrl.endsWith('/') ? `${baseUrl}messages` : `${baseUrl}/messages`);
    const apiKey = aiConfig.apiKey;

    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const ext = path.extname(originalFileName || filePath).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const candidateModels = [
      aiConfig.readModel,
      aiConfig.model,
      'claude-opus-5',
      'claude-sonnet-5',
      'gpt-5.4-mini',
    ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

    let lastError: any = null;

    for (const tryModel of candidateModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const payload = {
            model: tryModel,
            max_tokens: 2048,
            system: `${this.getPoExtractionPrompt()}\n\nCRITICAL: Return strictly valid JSON with no conversational text.`,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: mediaType,
                      data: base64Data,
                    },
                  },
                  {
                    type: 'text',
                    text: 'Extract all customer PO details and item table from this document strictly into JSON.',
                  },
                ],
              },
            ],
          };

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`ScaleMax API HTTP ${response.status}: ${errText.slice(0, 250)}`);
          }

          const resJson: any = await response.json();
          const contentArr = resJson?.content || [];
          const textBlock = contentArr.find((c: any) => c.type === 'text') || contentArr[0];
          return this.parseJsonResponse(textBlock?.text || '{}');
        } catch (err: any) {
          lastError = err;
          this.logger.warn(`ScaleMax Claude Vision (${tryModel}, attempt ${attempt}) failed: ${err.message}`);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    throw lastError || new Error('ScaleMax Claude PO extraction failed after retries.');
  }

  private async extractWithOpenAIVision(filePath: string, originalFileName: string, aiConfig: any): Promise<StructuredAiOrderOutput> {
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const ext = path.extname(originalFileName || filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const openaiClient = new OpenAI({ apiKey: aiConfig.apiKey });
    const response = await openaiClient.chat.completions.create({
      model: aiConfig.readModel || aiConfig.model || 'gpt-4o',
      messages: [
        { role: 'system', content: this.getPoExtractionPrompt() },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract this customer purchase order strictly into structured JSON.' },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Data}` },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    });

    const text = response.choices[0]?.message?.content || '{}';
    return this.parseJsonResponse(text);
  }

  private getPoExtractionPrompt(): string {
    return `You are an expert, state-of-the-art universal Sales Order and Customer Purchase Order extraction AI.
Your objective is to extract 100% accurate, complete header details, buyer/customer metadata, and all line items from any document (Purchase Order, Sales Order, Customer PO, Purchase Invoice, Quotation, PDF, Word doc, or Scanned Image) into structured JSON.

CRITICAL EXTRACTION RULES:
1. BUYER / CUSTOMER IDENTIFICATION & CONTACTS:
   - Identify the Buyer / Customer / Consignee / Bill To entity (the party purchasing or ordering the goods).
   - If the document is an invoice/order with 'BILL TO', 'BUYER', 'CUSTOMER', 'CONSIGNEE', or 'CLIENT', extract THAT entity as "customer_name" (e.g. "Aarav Home Furnishings Pvt. Ltd.").
   - NEVER confuse the seller/supplier/issuer (e.g., in the header banner or 'Sold By') with the customer.
   - CUSTOMER PHONE: Search thoroughly in the Buyer / Bill To / Consignee header or contact person box for Phone, Mobile, Tel, Contact No, WhatsApp (e.g. "+91 98250 12345", "9898012345", "0281-2456789"). Extract as "customer_phone". Do NOT leave null if present.
   - CUSTOMER EMAIL: Extract customer/buyer email address into "customer_email".
   - GSTIN: Extract 15-character Indian GSTIN (e.g. "24AAECA4567M1Z8") into "customer_gstin".
   - Extract full Billing Address and Shipping/Delivery Address (e.g., warehouse or delivery location).

2. ORDER METADATA:
   - Extract PO Number / Purchase Order Reference (e.g. 'PO/2026/311', 'PO-2026-089', 'SG/PI/2026/0521').
   - Standardize Order Date to YYYY-MM-DD format (e.g., '15-Sep-2026' -> '2026-09-15', '15/09/2026' -> '2026-09-15').
   - Standardize Delivery Date / Due Date to YYYY-MM-DD format if present.
   - Default currency to 'INR' unless explicitly stated otherwise.

3. COMPLETE ITEM TABLE EXTRACTION (EVERY ROW):
   - Extract EVERY row in the item table without skipping any line items.
   - item_name: Full product name / description.
   - item_code: Exact SKU / Item Code / Model No (e.g. "PKG-BOX-001", "PKG-TAPE-002", "PROD-MUG-RACK") if present; otherwise use the product name.
   - description: Specifications or description.
   - hsn_code: Exact 6 or 8 digit HSN/SAC code (e.g. "481910", "391910", "44201000").
   - qty: Exact numeric quantity (e.g. 500, 200, 50).
   - uom: Exact Unit of Measure ('Nos', 'Rolls', 'Packs', 'Kg', 'Pairs', 'Pcs', 'Units', 'Set', etc.).
   - rate: Exact unit price / rate per unit before tax (e.g. 42.00, 58.00, 620.00).
   - discount_percentage: Numeric discount percentage (e.g., 5% -> 5, 2% -> 2, 0% -> 0).
   - discount_amount: Calculated or extracted discount amount in INR.
   - tax_percentage: Total GST rate percentage (e.g. 18, 12, 5, 28; if CGST 9% + SGST 9%, total is 18).
   - warehouse: Delivery warehouse if mentioned, or default to "Stores - woodwolf".

4. DOCUMENT TOTALS & SUMMARY EXTRACTION (CRITICAL):
   - document_grand_total: The exact Grand Total / Final Net Payable amount printed on the PO / Invoice in the "TOTAL", "GRAND TOTAL", "NET PAYABLE", or "ORDER SUMMARY" box (e.g., 257591.73). Extract as a clean float number.
   - document_taxable_amount: The Total Taxable Amount / Net Subtotal before GST printed on the document (e.g. 218297.65). Extract as a clean float number if present.
   - document_tax_amount: The Total GST Tax (CGST + SGST or IGST) printed on the document (e.g. 39294.08). Extract as a clean float number if present.

CRITICAL: Return ONLY valid, parseable JSON strictly conforming to this schema:
{
  "customer_name": "Customer Name",
  "customer_email": "Email or null",
  "customer_phone": "Phone / Mobile Number or null",
  "customer_gstin": "15-digit GSTIN or null",
  "billing_address": "Full Billing Address or null",
  "shipping_address": "Full Shipping Address or null",
  "order_date": "YYYY-MM-DD",
  "delivery_date": "YYYY-MM-DD",
  "po_no": "PO Reference Number or null",
  "currency": "INR",
  "document_grand_total": 257591.73,
  "document_taxable_amount": 218297.65,
  "document_tax_amount": 39294.08,
  "items": [
    {
      "item_code": "PKG-BOX-001",
      "item_name": "Corrugated Carton Box 12x10x8",
      "description": "Corrugated Carton Box 12x10x8",
      "hsn_code": "48191000",
      "qty": 500,
      "uom": "Nos",
      "rate": 42.0,
      "discount_percentage": 0,
      "discount_amount": 0,
      "tax_percentage": 18,
      "warehouse": "Stores - woodwolf"
    }
  ]
}`;
  }

  private parseJsonResponse(text: string): StructuredAiOrderOutput {
    let cleanText = text.trim();
    const codeBlockMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      cleanText = codeBlockMatch[1].trim();
    }
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanText = cleanText.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(cleanText || '{}');
    return parsed;
  }

  private parseDateToIso(dateStr: any): string | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    const dmyMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      const year = dmyMatch[3];
      return `${year}-${month}-${day}`;
    }

    const monthMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
      january: '01', february: '02', march: '03', april: '04', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    };
    const textDateMatch = trimmed.match(/^(\d{1,2})[\s\-/,]+([A-Za-z]+)[\s\-/,]+(\d{4})/);
    if (textDateMatch) {
      const day = textDateMatch[1].padStart(2, '0');
      const mStr = textDateMatch[2].toLowerCase();
      const month = monthMap[mStr] || monthMap[mStr.substring(0, 3)];
      const year = textDateMatch[3];
      if (month) {
        return `${year}-${month}-${day}`;
      }
    }

    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    return null;
  }

  private sanitizeOrderOutput(raw: any): StructuredAiOrderOutput {
    const today = new Date().toISOString().split('T')[0];
    const defaultDelivery = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const rawItems = Array.isArray(raw.items) ? raw.items : [];
    const items = rawItems.map((it: any) => {
      const qty = Number(it.qty ?? it.quantity ?? it.total_quantity ?? 1) || 1;
      const rate = Number(it.rate ?? it.unit_price ?? it.rate_per_unit ?? it.price ?? 0) || 0;
      const cleanHsn = String(it.hsn_code ?? it.hsn ?? '').replace(/[^0-9]/g, '');
      let validHsn = cleanHsn;
      if (validHsn.length === 6) {
        validHsn = `${validHsn}00`;
      } else if (validHsn.length < 6) {
        validHsn = '44201000';
      }

      const discountPercentage = Number(it.discount_percentage) || 0;
      let discountAmount = Number(it.discount_amount) || 0;
      if (!discountAmount && discountPercentage > 0) {
        discountAmount = Number(((qty * rate * discountPercentage) / 100).toFixed(2));
      }

      const itemName = String(it.item_name ?? it.description ?? it.item_code ?? 'Product Item').trim();
      const itemCode = String(it.item_code ?? it.sku ?? it.item_name ?? it.description ?? 'Product Item').trim();

      return {
        item_code: itemCode,
        item_name: itemName,
        description: String(it.description ?? itemName).trim(),
        hsn_code: validHsn,
        qty,
        uom: String(it.uom ?? it.unit ?? 'Nos').trim(),
        rate,
        discount_percentage: discountPercentage,
        discount_amount: discountAmount,
        tax_percentage: Number(it.tax_percentage) || 18,
        warehouse: String(it.warehouse ?? 'Stores - woodwolf').trim(),
      };
    });

    // Customer & buyer field resolution across standard and nested structures
    const customerName =
      raw.customer_name ??
      raw.bill_to?.name ??
      raw.buyer?.name ??
      raw.customer?.name ??
      raw.buyer_name ??
      raw.customer ??
      raw.client?.name ??
      'Walk-in Customer';

    let customerPhone =
      raw.customer_phone ??
      raw.bill_to?.phone ??
      raw.bill_to?.mobile ??
      raw.bill_to?.contact ??
      raw.buyer?.phone ??
      raw.buyer?.mobile ??
      raw.buyer?.contact ??
      raw.customer?.phone ??
      raw.customer?.mobile ??
      raw.buyer_phone ??
      raw.contact_phone ??
      raw.contact_no ??
      raw.phone_number ??
      raw.mobile_number ??
      raw.mobile_no ??
      raw.phone ??
      raw.mobile ??
      raw.tel ??
      raw.telephone ??
      raw.consignee?.phone ??
      raw.consignee?.mobile ??
      undefined;

    if (customerPhone) {
      customerPhone = String(customerPhone).trim();
    }

    const customerEmail =
      raw.customer_email ??
      raw.bill_to?.email ??
      raw.buyer?.email ??
      raw.customer?.email ??
      raw.email ??
      raw.contact_email ??
      raw.buyer_email ??
      undefined;

    const customerGstin =
      raw.customer_gstin ??
      raw.bill_to?.gstin ??
      raw.buyer?.gstin ??
      raw.customer?.gstin ??
      raw.gstin ??
      raw.tax_id ??
      undefined;

    const billingAddress =
      raw.billing_address ??
      raw.bill_to?.address ??
      raw.buyer?.address ??
      raw.customer?.address ??
      undefined;

    // If phone is missing from dedicated property, check if embedded in raw billing address / buyer text
    if (!customerPhone && billingAddress) {
      const phoneMatch = String(billingAddress).match(/(?:Ph|Phone|Tel|Mobile|Mob|Contact|Cell|WhatsApp)?[:\s\-]*([+]?[0-9]{2,4}[-\s]?[0-9]{6,12})/i);
      if (phoneMatch && phoneMatch[1].replace(/[^0-9]/g, '').length >= 10) {
        customerPhone = phoneMatch[1].trim();
      }
    }

    const shippingAddress =
      raw.shipping_address ??
      raw.ship_to?.address ??
      raw.delivery_address ??
      billingAddress ??
      undefined;

    const rawOrderDate = raw.order_date ?? raw.po_date ?? raw.date;
    const orderDate = this.parseDateToIso(rawOrderDate) || today;

    const rawDeliveryDate = raw.delivery_date ?? raw.due_date ?? raw.expected_delivery;
    const deliveryDate = this.parseDateToIso(rawDeliveryDate) || defaultDelivery;

    const poNo =
      raw.po_no ??
      raw.po_number ??
      raw.purchase_order_number ??
      raw.order_number ??
      undefined;

    const rawDocGrandTotal =
      raw.document_grand_total ??
      raw.grand_total ??
      raw.total_amount ??
      raw.total ??
      raw.order_total ??
      raw.order_summary?.grand_total ??
      raw.order_summary?.total_amount ??
      undefined;
    const documentGrandTotal = rawDocGrandTotal !== undefined && !isNaN(Number(rawDocGrandTotal)) ? Number(rawDocGrandTotal) : undefined;

    const rawDocTaxable =
      raw.document_taxable_amount ??
      raw.taxable_amount ??
      raw.order_summary?.total_taxable_amount ??
      raw.order_summary?.taxable_amount ??
      undefined;
    const documentTaxableAmount = rawDocTaxable !== undefined && !isNaN(Number(rawDocTaxable)) ? Number(rawDocTaxable) : undefined;

    const rawDocTax =
      raw.document_tax_amount ??
      raw.total_tax ??
      raw.tax_amount ??
      raw.order_summary?.total_tax ??
      undefined;
    const documentTaxAmount = rawDocTax !== undefined && !isNaN(Number(rawDocTax)) ? Number(rawDocTax) : undefined;

    return {
      customer_name: String(customerName).trim(),
      customer_email: customerEmail,
      customer_phone: customerPhone,
      customer_gstin: customerGstin,
      billing_address: billingAddress,
      shipping_address: shippingAddress,
      order_date: orderDate,
      delivery_date: deliveryDate,
      po_no: poNo,
      currency: raw.currency || 'INR',
      items,
      document_grand_total: documentGrandTotal,
      document_taxable_amount: documentTaxableAmount,
      document_tax_amount: documentTaxAmount,
      ai_reply: raw.ai_reply || raw.reply || undefined,
    };
  }

  private buildHeuristicOrderDraft(
    text: string,
    catalog: ErpItem[],
    currentDraft?: any,
  ): StructuredAiOrderOutput {
    const today = new Date().toISOString().split('T')[0];
    const delivery = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const items: any[] = currentDraft?.items ? [...currentDraft.items] : [];
    const lower = text.toLowerCase();

    for (const cat of catalog) {
      if (lower.includes(cat.item_name.toLowerCase()) || lower.includes(cat.item_code.toLowerCase())) {
        const existingIdx = items.findIndex((it) => it.item_code === cat.item_code);
        if (existingIdx > -1) {
          items[existingIdx].qty += 1;
        } else {
          items.push({
            item_code: cat.item_code,
            item_name: cat.item_name,
            description: cat.description || cat.item_name,
            hsn_code: cat.gst_hsn_code || '44201000',
            qty: 1,
            uom: cat.stock_uom || 'Nos',
            rate: cat.standard_rate || 1000,
            discount_percentage: 0,
            discount_amount: 0,
            tax_percentage: 18,
            warehouse: 'Stores - woodwolf',
          });
        }
      }
    }

    if (items.length === 0) {
      items.push({
        item_code: 'PROD-MUG-RACK',
        item_name: 'Handcrafted Wooden Mug Rack',
        description: 'Solid natural teak wood mug tree rack',
        hsn_code: '44201000',
        qty: 1,
        uom: 'Nos',
        rate: 1850,
        discount_percentage: 0,
        discount_amount: 0,
        tax_percentage: 18,
        warehouse: 'Stores - woodwolf',
      });
    }

    // Try extracting buyer metadata from text if present
    const buyerMatch = text.match(/(?:Buyer|Customer|Bill To|Client|Purchaser)[:\s]+([^\n,]+)/i);
    const phoneMatch = text.match(/(?:Phone|Tel|Mobile|Mob|Contact|Cell|WhatsApp)[:\s\-]*([+]?[0-9]{2,4}[-\s]?[0-9]{6,12})/i);
    const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    const gstinMatch = text.match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b/i);
    const poMatch = text.match(/(?:PO\s*(?:No|Number|#)?|Purchase\s*Order)[:\s]+([A-Z0-9\-_/]+)/i);

    return {
      customer_name: currentDraft?.customer_name || (buyerMatch ? buyerMatch[1].trim() : 'Walk-in Customer'),
      customer_email: currentDraft?.customer_email || (emailMatch ? emailMatch[1].trim() : undefined),
      customer_phone: currentDraft?.customer_phone || (phoneMatch ? phoneMatch[1].trim() : undefined),
      customer_gstin: currentDraft?.customer_gstin || (gstinMatch ? gstinMatch[1].toUpperCase().trim() : undefined),
      order_date: today,
      delivery_date: delivery,
      po_no: currentDraft?.po_no || (poMatch ? poMatch[1].trim() : undefined),
      currency: 'INR',
      items,
      ai_reply: 'Generated sales order draft from document analysis.',
    };
  }
}
