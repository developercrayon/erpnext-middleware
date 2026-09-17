import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { InvoiceExtractedData } from '../../common/interfaces/invoice-schema.interface';
import OpenAI from 'openai';
import { AiSettingsService } from '../ai/services/ai-settings.service';
import { AiConfigType } from '../../database/entities/ai.entity';

@Injectable()
export class AIInvoiceExtractionService {
  private readonly logger = new Logger(AIInvoiceExtractionService.name);

  constructor(private readonly aiSettingsService: AiSettingsService) {}

  /**
   * Main multi-AI extraction pipeline.
   * Supports PDF documents, images (PNG, JPG, WebP), and scans.
   * Dynamically cascades across configured AI engines:
   * 1. ScaleMax Claude (claude-opus-5 / claude-3-5-sonnet)
   * 2. OpenAI (gpt-4o)
   */
  async extractInvoiceData(filePath: string, originalFileName: string): Promise<InvoiceExtractedData> {
    this.logger.log(`Beginning Multi-AI Extraction for file: ${originalFileName} (${filePath})`);

    const ext = path.extname(originalFileName || filePath).toLowerCase();
    const isPdf = ext === '.pdf';
    const isWordDoc = ext === '.doc' || ext === '.docx';

    // 1. If Word document (.doc / .docx), extract text content
    if (isWordDoc) {
      try {
        const wordText = await this.extractWordDocText(filePath);
        if (wordText && wordText.trim().length > 30) {
          this.logger.log(`Word document text extracted successfully (${wordText.length} chars). Processing with AI text extraction...`);
          const result = await this.extractFromDocumentText(wordText);
          if (result && (result.supplier?.name || (result.items && result.items.length > 0))) {
            this.logger.log('Word DOC/DOCX AI extraction completed successfully.');
            return this.sanitizeExtractedData(result);
          }
        }
      } catch (wordErr) {
        this.logger.warn(`Direct Word DOC/DOCX text extraction failed: ${wordErr.message}.`);
      }
    }

    // 2. If PDF document, extract native document text first for maximum precision
    if (isPdf) {
      try {
        const pdfText = await this.extractPdfText(filePath);
        if (pdfText && pdfText.trim().length > 30) {
          this.logger.log(`PDF text extracted successfully (${pdfText.length} chars). Processing with AI text extraction...`);
          const result = await this.extractFromDocumentText(pdfText);
          if (result && (result.supplier?.name || (result.items && result.items.length > 0))) {
            this.logger.log('PDF AI extraction completed successfully.');
            return this.sanitizeExtractedData(result);
          }
        }
      } catch (pdfErr) {
        this.logger.warn(`Direct PDF text extraction failed: ${pdfErr.message}. Falling back to Vision AI pipeline.`);
      }
    }

    const errors: string[] = [];
    
    // Fetch dynamic AI Configuration from the database
    let aiConfig;
    try {
      aiConfig = await this.aiSettingsService.getDecryptedConfig(AiConfigType.CONTENT);
    } catch (err) {
      throw new Error(`AI Configuration missing or invalid in database: ${err.message}`);
    }

    // 3. Try ScaleMax Claude Vision API
    if (aiConfig.provider === 'scalemax') {
      try {
        this.logger.log('Attempting Vision Extraction via ScaleMax Claude API...');
        const result = await this.extractWithScaleMaxClaude(filePath, originalFileName, aiConfig);
        if (result && (result.supplier?.name || (result.items && result.items.length > 0))) {
          this.logger.log('ScaleMax Claude extraction completed successfully.');
          return this.sanitizeExtractedData(result);
        }
      } catch (err) {
        this.logger.warn(`ScaleMax Claude extraction failed: ${err.message}. Cascading...`);
        errors.push(`ScaleMax: ${err.message}`);
      }
    }

    // 5. Try OpenAI Vision if available
    if (aiConfig.provider === 'openai') {
      try {
        this.logger.log('Attempting Vision Extraction via OpenAI API...');
        const result = await this.extractWithOpenAI(filePath, originalFileName, aiConfig);
        if (result && (result.supplier?.name || (result.items && result.items.length > 0))) {
          this.logger.log('OpenAI extraction completed successfully.');
          return this.sanitizeExtractedData(result);
        }
      } catch (err) {
        this.logger.warn(`OpenAI extraction failed: ${err.message}`);
        errors.push(`OpenAI: ${err.message}`);
      }
    }

    throw new Error(`All AI Vision & Document extraction models failed. Details: ${errors.join(' | ')}`);
  }

  /**
   * Extract text layer from digital Word (.doc / .docx) files
   */
  private async extractWordDocText(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    try {
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
    } catch (err) {
      this.logger.warn(`Word document text extraction failed for ${filePath}: ${err.message}`);
    }
    return '';
  }

  /**
   * Extract text layer from digital PDF files using pdf-parse v2
   */
  private async extractPdfText(filePath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(filePath);
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PDFParse, VerbosityLevel } = require('pdf-parse');
      const parser = new PDFParse({
        verbosity: VerbosityLevel ? VerbosityLevel.ERRORS : 0,
        data: dataBuffer,
      });
      await parser.load();
      const res = await parser.getText();
      return res?.text || '';
    } catch (e) {
      this.logger.warn(`PDFParse error: ${e.message}`);
      return '';
    }
  }

  /**
   * Extract structured invoice data from document text using AI cascade
   */
  private async extractFromDocumentText(documentText: string): Promise<InvoiceExtractedData> {
    const errors: string[] = [];

    let aiConfig;
    try {
      aiConfig = await this.aiSettingsService.getDecryptedConfig(AiConfigType.IMAGE);
    } catch (err) {
      throw new Error(`AI Configuration missing or invalid in database: ${err.message}`);
    }

    // 1. Try ScaleMax Claude API
    if (aiConfig.provider === 'scalemax') {
      const scaleMaxKey = aiConfig.apiKey;
      const baseUrl = aiConfig.url || process.env.SCALEMAX_BASE_URL || 'https://api.scalemax.pro/v1';
      const apiUrl = aiConfig.readUrl || (baseUrl.endsWith('/') ? `${baseUrl}messages` : `${baseUrl}/messages`);
      const defaultModel = aiConfig.readModel || aiConfig.model || 'claude-opus-5';
      const candidateModels = [
        defaultModel,
        'claude-3-5-sonnet',
        'claude-3-5-haiku',
      ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

      if (scaleMaxKey && scaleMaxKey.trim()) {
        for (const tryModel of candidateModels) {
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const payload = {
                model: tryModel,
                max_tokens: 2048,
                system: `${this.getExtractionSystemPrompt()}\n\nCRITICAL: Return ONLY valid, parseable JSON conforming to the schema. Start immediately with '{' and end with '}'. No conversational text or markdown explanation.`,
                messages: [
                  {
                    role: 'user',
                    content: `Please extract all invoice fields from this document text into structured JSON strictly adhering to the schema:\n\n${documentText}`,
                  },
                ],
              };

              const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${scaleMaxKey}`,
                },
                body: JSON.stringify(payload),
              });

              if (response.ok) {
                const resJson: any = await response.json();
                const contentArr = resJson?.content || [];
                const textBlock = contentArr.find((c: any) => c.type === 'text') || contentArr[0];
                const rawText = textBlock?.text || '';
                if (rawText) {
                  return this.parseJsonResponse(rawText);
                }
              } else {
                const errText = await response.text();
                errors.push(`ScaleMax text (${tryModel}): HTTP ${response.status} - ${errText.slice(0, 200)}`);
              }
            } catch (err: any) {
              errors.push(`ScaleMax text (${tryModel}): ${err.message}`);
            }
            if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
    }

    // 3. Try OpenAI API for text extraction
    if (aiConfig.provider === 'openai') {
      try {
        const openaiClient = new OpenAI({ apiKey: aiConfig.apiKey });
        const response = await openaiClient.chat.completions.create({
          model: aiConfig.readModel || aiConfig.model || 'gpt-4o',
          messages: [
            { role: 'system', content: this.getExtractionSystemPrompt() },
            { role: 'user', content: `Extract invoice data from this document text:\n\n${documentText}` },
          ],
          response_format: { type: 'json_object' },
        });
        const rawText = response.choices[0]?.message?.content || '{}';
        return this.parseJsonResponse(rawText);
      } catch (err) {
        errors.push(`OpenAI text: ${err.message}`);
      }
    }

    throw new Error(`Text AI extraction failed: ${errors.join(' | ')}`);
  }

  private getExtractionSystemPrompt(): string {
    return `You are an expert, state-of-the-art universal invoice data extraction engine.
Your task is to accurately extract all invoice fields from any document layout, orientation, or style (Tax Invoice, GST Bill, B2B/B2C Retail Invoice, Bill of Supply, Cash Memo, Scanned or Photographed Receipt, etc.).

CRITICAL EXTRACTION RULES:
1. SUPPLIER / SELLER IDENTIFICATION:
   - Identify the issuing supplier/vendor/seller (typically in the top header banner, letterhead, 'Sold By', 'From', 'Consignor', or supplier box).
   - NEVER confuse the Buyer/Customer/Consignee ('Billed To', 'Ship To', 'Buyer', 'Consignee') with the Supplier.
   - Extract Supplier Name, 15-character GSTIN (e.g., 27ABCDE1234F1Z5), Full Address, Phone, and Email.

2. INVOICE HEADER & METADATA:
   - Extract Invoice Number / Bill Number accurately (e.g. 'SR/PI/2024-25/0156', 'INV-2026-NEW-8801').
   - Standardize Invoice Date to YYYY-MM-DD format (e.g., '15-Apr-2024' -> '2024-04-15', '15/09/2026' -> '2026-09-15').
   - Standardize Due Date to YYYY-MM-DD format. If an explicit due date is not printed, but payment terms or credit days are mentioned (e.g. 'Net 15 days', 'Net 30', '45 days', '60 days credit'), calculate the exact due_date by adding those days to invoice_date.
   - Extract Currency (e.g. 'INR', 'USD'), PO Number, Payment Terms (e.g. 'Net 30', 'Net 15', 'Due on Receipt'), and Warehouse / Destination if mentioned.

3. LINE ITEMS (EVERY ROW IN TABLE):
   - Extract EVERY line item row accurately without skipping any rows.
   - description: Clean, full product or service name.
   - item_code: SKU / Item Code / Model No / Part No if present or in description.
   - hsn_code: HSN or SAC code (e.g. '73061910', '73181590', '85444920').
   - quantity: Exact numeric quantity (e.g. 100, 200, 500, 300).
   - uom: Unit of measure (e.g. 'Nos', 'Pcs', 'Units', 'Box', 'Kg', 'M', 'Mtrs', default 'Nos').
   - rate: Exact unit price / rate per item before taxes (e.g. 500.00, 25.00, 2.00, 1.50, 45.00). DO NOT corrupt decimals (e.g. 500.00 is 500, NOT 50000).
   - discount_percentage & discount_amount: Any discount specified on the line (default 0).
   - tax_percentage: GST / Tax rate percentage (e.g. 18, 12, 5, 28).
   - tax_amount: Tax amount for the line item.
   - amount: Line total taxable value (Quantity * Rate - Discount).

4. TAXES & SUMMARY TOTALS:
   - cgst: Central GST amount.
   - sgst: State GST amount.
   - igst: Integrated GST amount.
   - total_tax: Sum of all taxes.
   - subtotal: Total taxable value before taxes.
   - discount: Overall invoice discount if any.
   - taxable_amount: Net taxable subtotal.
   - grand_total: Final invoice payable amount.

Output ONLY valid, parseable JSON conforming strictly to this schema:
{
  "supplier": {
    "name": "Supplier Company Name or null",
    "gstin": "15-digit GSTIN or null",
    "address": "Full Address or null",
    "phone": "Phone or null",
    "email": "Email or null",
    "confidence": { "name": 0.99, "gstin": 0.99, "overall": 0.98 }
  },
  "invoice": {
    "number": "Invoice Number or null",
    "date": "YYYY-MM-DD or null",
    "due_date": "YYYY-MM-DD or null",
    "currency": "INR",
    "po_number": "PO Number or null",
    "delivery_note": null,
    "confidence": { "number": 0.99, "date": 0.98, "due_date": 0.95 }
  },
  "billing_address": {
    "address": "Buyer Billed To Name and Address or null",
    "city": "City or null",
    "state": "State or null",
    "postal_code": "PIN or null",
    "country": "India"
  },
  "shipping_address": {
    "address": "Buyer Shipping Address or null",
    "city": "City or null",
    "state": "State or null",
    "postal_code": "PIN or null",
    "country": "India"
  },
  "warehouse": "Destination Warehouse or null",
  "payment_terms": "Payment Terms or null",
  "items": [
    {
      "description": "Item product name",
      "item_code": "SKU / Code or null",
      "hsn_code": "HSN/SAC or null",
      "quantity": 10,
      "uom": "Nos",
      "rate": 350.00,
      "discount_percentage": 0,
      "discount_amount": 0,
      "tax_percentage": 18,
      "tax_amount": 630.00,
      "amount": 3500.00,
      "confidence": 0.98
    }
  ],
  "taxes": {
    "cgst": 315.00,
    "sgst": 315.00,
    "igst": 0,
    "other_tax": 0,
    "total_tax": 630.00
  },
  "totals": {
    "subtotal": 3500.00,
    "discount": 0,
    "taxable_amount": 3500.00,
    "grand_total": 4130.00
  },
  "notes": null,
  "overall_confidence": 0.98
}`;
  }

  /**
   * ScaleMax Claude Vision extraction using Claude-Opus-5 / Claude-3-5-Sonnet
   */
  private async extractWithScaleMaxClaude(filePath: string, originalFileName: string, aiConfig: any): Promise<InvoiceExtractedData> {
    const baseUrl = aiConfig.url || process.env.SCALEMAX_BASE_URL || 'https://api.scalemax.pro/v1';
    const apiUrl = aiConfig.readUrl || (baseUrl.endsWith('/') ? `${baseUrl}messages` : `${baseUrl}/messages`);
    const apiKey = aiConfig.apiKey;
    const model = aiConfig.readModel || aiConfig.model || 'claude-opus-5';

    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = this.getMimeType(filePath, originalFileName);

    let mediaType = 'image/png';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) {
      mediaType = 'image/jpeg';
    } else if (mimeType.includes('webp')) {
      mediaType = 'image/webp';
    } else if (mimeType.includes('gif')) {
      mediaType = 'image/gif';
    }

    const candidateModels = [
      model,
      'claude-3-5-sonnet',
      'claude-3-5-haiku',
    ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

    let lastError: any = null;
    for (const tryModel of candidateModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          this.logger.log(`Attempting ScaleMax Claude with model: ${tryModel} (attempt ${attempt}/2)...`);
          const payload = {
            model: tryModel,
            max_tokens: 2048,
            system: `${this.getExtractionSystemPrompt()}\n\nCRITICAL: Return ONLY valid, parseable JSON conforming to the schema. Do NOT include markdown formatting, backticks, conversational preamble, or explanations. Start immediately with '{' and end with '}'.`,
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
                    text: 'Extract all invoice fields from this document into structured JSON strictly adhering to the schema.',
                  },
                ],
              },
            ],
          };

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`ScaleMax API HTTP ${response.status}: ${errText.slice(0, 300)}`);
          }

          const resJson: any = await response.json();
          const contentArr = resJson?.content || [];
          const textBlock = contentArr.find((c: any) => c.type === 'text') || contentArr[0];
          const rawText = textBlock?.text || '';

          if (!rawText) {
            throw new Error('Empty response content received from ScaleMax API');
          }

          return this.parseJsonResponse(rawText);
        } catch (err: any) {
          lastError = err;
          this.logger.warn(`ScaleMax attempt ${attempt} for model ${tryModel} failed: ${err.message}`);
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
      }
    }

    throw lastError || new Error('ScaleMax Claude extraction failed after all retries');
  }

  /**
   * OpenAI Vision extraction
   */
  private async extractWithOpenAI(filePath: string, originalFileName: string, aiConfig: any): Promise<InvoiceExtractedData> {
    const fileBuffer = fs.readFileSync(filePath);
    const base64Data = fileBuffer.toString('base64');
    const mimeType = this.getMimeType(filePath, originalFileName);
    const openaiClient = new OpenAI({ apiKey: aiConfig.apiKey });

    const response = await openaiClient.chat.completions.create({
      model: aiConfig.readModel || aiConfig.model || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: this.getExtractionSystemPrompt(),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract invoice data according to the schema in pure JSON.' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    });

    const text = response.choices[0]?.message?.content || '{}';
    return this.parseJsonResponse(text);
  }

  private parseJsonResponse(text: string): InvoiceExtractedData {
    let cleanText = text.trim();

    // Match code block ```json ... ``` or ``` ... ```
    const codeBlockMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch) {
      cleanText = codeBlockMatch[1].trim();
    }

    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(cleanText);
    } catch (err) {
      // Clean up trailing commas or control characters
      const sanitized = cleanText
        .replace(/,\s*([\]}])/g, '$1')
        .replace(/[\u0000-\u001F]+/g, (match) => (match === '\n' || match === '\r' || match === '\t' ? match : ''));
      return JSON.parse(sanitized);
    }
  }

  private parseDateToIso(dateStr: any): string | null {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const trimmed = dateStr.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    const dmyMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
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
    const textDateMatch = trimmed.match(/^(\d{1,2})[\s\-/,]+([A-Za-z]+)[\s\-/,]+(\d{4})$/);
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

  private calculateDueDateFromTerms(invoiceDateIso: string, termsOrDueDateText?: string | null): string | null {
    if (!termsOrDueDateText || typeof termsOrDueDateText !== 'string') return null;
    const cleanTerms = termsOrDueDateText.trim();
    if (!cleanTerms) return null;

    // 1. Check if it's already an explicit calendar date
    const parsedDirect = this.parseDateToIso(cleanTerms);
    if (parsedDirect && /^\d{4}-\d{2}-\d{2}$/.test(parsedDirect)) {
      return parsedDirect;
    }

    // 2. Extract number of days from patterns like "Net 15", "Net 30 days", "45 Days", "within 60 days", etc.
    const daysMatch = cleanTerms.match(/(?:net\s*)?(\d{1,3})\s*days?/i) || cleanTerms.match(/net\s*(\d{1,3})/i);
    if (daysMatch) {
      const days = parseInt(daysMatch[1], 10);
      if (!isNaN(days) && days >= 0 && days <= 365) {
        try {
          const invDate = new Date(invoiceDateIso);
          if (!isNaN(invDate.getTime())) {
            invDate.setDate(invDate.getDate() + days);
            return invDate.toISOString().split('T')[0];
          }
        } catch {
          // fallback
        }
      }
    }

    // 3. Immediate / Due on Receipt / Cash
    if (/due\s+on\s+receipt|immediate|cash/i.test(cleanTerms)) {
      return invoiceDateIso;
    }

    return null;
  }

  /**
   * Sanitizes OCR-corrupted numeric string by fixing common optical character glyph confusions:
   * e.g., 'S'/'s' -> '5', 'O'/'o' -> '0', 'I'/'l' -> '1', 'B' -> '8', 'Z'/'z' -> '2'
   */
  private sanitizeNumericString(val: any): string {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();

    // Remove currency signs (₹, Rs, INR, $, etc.) and thousands separators
    str = str.replace(/[₹$€£]|Rs\.?|INR/gi, '').replace(/,/g, '').trim();

    // If it's already a clean decimal or integer number, return directly
    if (/^-?\d+(?:\.\d+)?$/.test(str)) {
      return str;
    }

    // Apply OCR glyph correction for numbers in corrupted OCR text
    const corrected = str
      .replace(/[Ss]/g, '5')
      .replace(/[Oo]/g, '0')
      .replace(/[Il|]/g, '1')
      .replace(/[Bb]/g, '8')
      .replace(/[Zz]/g, '2');

    // Remove any remaining invalid non-numeric chars except digits and decimal point
    const cleaned = corrected.replace(/[^0-9.-]/g, '');
    return cleaned;
  }

  private parseNumeric(val: any, defaultVal = 0): number {
    if (val === null || val === undefined) return defaultVal;
    if (typeof val === 'number') return isNaN(val) ? defaultVal : val;
    const clean = this.sanitizeNumericString(val);
    const num = parseFloat(clean);
    return isNaN(num) ? defaultVal : num;
  }

  /**
   * Cleans HSN / SAC codes and fixes OCR glyph errors
   */
  private sanitizeHsnCode(val: any): string | null {
    if (!val) return null;
    const cleanNum = this.sanitizeNumericString(val).replace(/[^0-9]/g, '');
    if (cleanNum.length >= 2 && cleanNum.length <= 8) {
      return cleanNum;
    }
    return String(val).replace(/[^0-9A-Za-z]/g, '').trim() || null;
  }

  /**
   * Auto-corrects 15-character Indian GSTIN against known OCR glyph confusion patterns
   * Format: ^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$
   */
  private sanitizeGstin(rawGstin: any): string | null {
    if (!rawGstin || typeof rawGstin !== 'string') return null;
    let clean = rawGstin.toUpperCase().replace(/[^0-9A-Z]/g, '').trim();
    if (!clean) return null;

    if (clean.length === 15) {
      const chars = clean.split('');

      // Pos 0-1: State Code (Digits 0-9)
      for (let i = 0; i <= 1; i++) {
        if (chars[i] === 'O' || chars[i] === 'Q') chars[i] = '0';
        else if (chars[i] === 'I' || chars[i] === 'L') chars[i] = '1';
        else if (chars[i] === 'Z') chars[i] = '2';
        else if (chars[i] === 'S') chars[i] = '5';
        else if (chars[i] === 'B') chars[i] = '8';
      }

      // Pos 2-6: PAN entity alphabets (Letters A-Z)
      for (let i = 2; i <= 6; i++) {
        if (chars[i] === '0') chars[i] = 'O';
        else if (chars[i] === '1') chars[i] = 'I';
        else if (chars[i] === '5') chars[i] = 'S';
        else if (chars[i] === '8') chars[i] = 'B';
        else if (chars[i] === '2') chars[i] = 'Z';
      }

      // Pos 7-10: PAN sequence digits (Digits 0-9)
      for (let i = 7; i <= 10; i++) {
        if (chars[i] === 'O' || chars[i] === 'Q') chars[i] = '0';
        else if (chars[i] === 'I' || chars[i] === 'L') chars[i] = '1';
        else if (chars[i] === 'Z') chars[i] = '2';
        else if (chars[i] === 'S') chars[i] = '5';
        else if (chars[i] === 'B') chars[i] = '8';
      }

      // Pos 11: PAN check alphabet (Letter A-Z)
      if (chars[11] === '0') chars[11] = 'O';
      else if (chars[11] === '1') chars[11] = 'I';
      else if (chars[11] === '5') chars[11] = 'S';
      else if (chars[11] === '8') chars[11] = 'B';
      else if (chars[11] === '2') chars[11] = 'Z';

      // Pos 13: Default 'Z'
      if (chars[13] === '2') chars[13] = 'Z';

      clean = chars.join('');
    }

    return clean;
  }

  private sanitizeExtractedData(data: any): InvoiceExtractedData {
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems.map((it: any) => {
      let description = (it.description || it.item_name || 'Unidentified Item').trim();
      let itemCode = it.item_code ? String(it.item_code).trim() : null;

      // Extract SKU prefix from description if item_code is missing
      if (!itemCode) {
        const prefixMatch = description.match(/^([A-Z0-9_\-\/]{3,30})\s*[-–:|]\s*(.+)$/i);
        if (prefixMatch) {
          itemCode = prefixMatch[1].trim();
          description = prefixMatch[2].trim();
        }
      }

      const hsnCode = this.sanitizeHsnCode(it.hsn_code);
      const quantity = this.parseNumeric(it.quantity, 1);
      const rate = this.parseNumeric(it.rate, 0);
      const discountPercentage = this.parseNumeric(it.discount_percentage, 0);
      let discountAmount = this.parseNumeric(it.discount_amount, 0);
      if (!discountAmount && discountPercentage > 0) {
        discountAmount = (quantity * rate * discountPercentage) / 100;
      }
      const taxableLine = quantity * rate - discountAmount;
      const taxPercentage = this.parseNumeric(it.tax_percentage, 0);
      let taxAmount = this.parseNumeric(it.tax_amount, 0);
      if (!taxAmount && taxPercentage > 0) {
        taxAmount = (taxableLine * taxPercentage) / 100;
      }
      const rawAmount = this.parseNumeric(it.amount, 0);
      const amount = rawAmount > 0 ? rawAmount : taxableLine;

      return {
        description,
        item_code: itemCode,
        hsn_code: hsnCode,
        quantity,
        uom: it.uom || 'Nos',
        rate,
        discount_percentage: discountPercentage,
        discount_amount: discountAmount,
        tax_percentage: taxPercentage,
        tax_amount: Number(taxAmount.toFixed(2)),
        amount: Number(amount.toFixed(2)),
        confidence: this.parseNumeric(it.confidence, 0.98),
      };
    });

    const itemsSubtotal = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    const itemsTax = items.reduce((sum, it) => sum + (Number(it.tax_amount) || 0), 0);

    let cgst = this.parseNumeric(data.taxes?.cgst, 0);
    let sgst = this.parseNumeric(data.taxes?.sgst, 0);
    let igst = this.parseNumeric(data.taxes?.igst, 0);
    const otherTax = this.parseNumeric(data.taxes?.other_tax, 0);
    let totalTax = this.parseNumeric(data.taxes?.total_tax, 0);

    if (totalTax === 0 && (cgst > 0 || sgst > 0 || igst > 0)) {
      totalTax = cgst + sgst + igst + otherTax;
    } else if (totalTax === 0 && itemsTax > 0) {
      totalTax = itemsTax;
    }

    if (totalTax > 0 && cgst === 0 && sgst === 0 && igst === 0) {
      cgst = Number((totalTax / 2).toFixed(2));
      sgst = Number((totalTax / 2).toFixed(2));
    }

    const discount = this.parseNumeric(data.totals?.discount, 0) || items.reduce((sum, it) => sum + (Number(it.discount_amount) || 0), 0);
    const subtotal = this.parseNumeric(data.totals?.subtotal, 0) || itemsSubtotal || 0;
    const taxableAmount = this.parseNumeric(data.totals?.taxable_amount, 0) || Math.max(0, subtotal - (data.totals?.subtotal ? 0 : discount));
    let grandTotal = this.parseNumeric(data.totals?.grand_total, 0);

    if (grandTotal === 0 && (subtotal > 0 || taxableAmount > 0)) {
      grandTotal = (taxableAmount > 0 ? taxableAmount : subtotal) + totalTax;
    }

    const rawDate = data.invoice?.date;
    const invoiceDate = this.parseDateToIso(rawDate) || new Date().toISOString().split('T')[0];
    const rawDueDate = data.invoice?.due_date;
    const paymentTerms = data.payment_terms || data.invoice?.payment_terms || null;

    // 1. Try parsing explicit due date
    let dueDate = this.parseDateToIso(rawDueDate);
    // 2. If due date is missing or same as invoice date, try calculating from terms/text
    if (!dueDate || dueDate === invoiceDate) {
      const calculatedFromTerms =
        this.calculateDueDateFromTerms(invoiceDate, rawDueDate) ||
        this.calculateDueDateFromTerms(invoiceDate, paymentTerms);
      if (calculatedFromTerms) {
        dueDate = calculatedFromTerms;
      }
    }
    if (!dueDate) {
      dueDate = invoiceDate;
    }

    return {
      supplier: {
        name: data.supplier?.name || null,
        gstin: this.sanitizeGstin(data.supplier?.gstin),
        address: data.supplier?.address || null,
        phone: data.supplier?.phone || null,
        email: data.supplier?.email || null,
        confidence: data.supplier?.confidence || { name: 0.98, gstin: 0.99, overall: 0.98 },
      },
      invoice: {
        number: data.invoice?.number ? String(data.invoice.number).trim() : null,
        date: invoiceDate,
        due_date: dueDate,
        currency: data.invoice?.currency || 'INR',
        po_number: data.invoice?.po_number ? String(data.invoice.po_number).trim() : null,
        delivery_note: data.invoice?.delivery_note || null,
        confidence: data.invoice?.confidence || { number: 0.98, date: 0.98 },
      },
      billing_address: {
        address: data.billing_address?.address || null,
        city: data.billing_address?.city || null,
        state: data.billing_address?.state || null,
        postal_code: data.billing_address?.postal_code || null,
        country: data.billing_address?.country || 'India',
      },
      shipping_address: {
        address: data.shipping_address?.address || null,
        city: data.shipping_address?.city || null,
        state: data.shipping_address?.state || null,
        postal_code: data.shipping_address?.postal_code || null,
        country: data.shipping_address?.country || 'India',
      },
      warehouse: data.warehouse || data.destination_warehouse || data.set_warehouse || null,
      items,
      taxes: {
        cgst: Number(cgst.toFixed(2)),
        sgst: Number(sgst.toFixed(2)),
        igst: Number(igst.toFixed(2)),
        other_tax: Number(otherTax.toFixed(2)),
        total_tax: Number(totalTax.toFixed(2)),
      },
      totals: {
        subtotal: Number(subtotal.toFixed(2)),
        discount: Number(discount.toFixed(2)),
        taxable_amount: Number(taxableAmount.toFixed(2)),
        grand_total: Number(grandTotal.toFixed(2)),
      },
      payment_terms: data.payment_terms || data.invoice?.payment_terms || null,
      notes: data.notes || null,
      overall_confidence: this.parseNumeric(data.overall_confidence, 0.98),
    };
  }

  private getMimeType(filePath: string, originalName: string): string {
    const ext = path.extname(originalName || filePath).toLowerCase();
    switch (ext) {
      case '.pdf':
        return 'application/pdf';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      case '.gif':
        return 'image/gif';
      case '.doc':
        return 'application/msword';
      case '.docx':
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      default:
        return 'application/octet-stream';
    }
  }
}
