import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { PurchaseInvoiceDocument } from '../../database/entities/purchase-invoice-document.entity';
import { PurchaseInvoiceDocumentItem } from '../../database/entities/purchase-invoice-document-item.entity';
import { ProcessingStatus } from '../../common/enums/processing-status.enum';
import { AIInvoiceExtractionService } from '../ai-extraction/ai-invoice-extraction.service';
import { SupplierMatchingService } from '../matching/supplier-matching.service';
import { ItemMatchingService } from '../matching/item-matching.service';
import { InvoiceValidationService } from '../validation/invoice-validation.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);

  constructor(
    @InjectRepository(PurchaseInvoiceDocument)
    private readonly docRepo: Repository<PurchaseInvoiceDocument>,
    @InjectRepository(PurchaseInvoiceDocumentItem)
    private readonly docItemRepo: Repository<PurchaseInvoiceDocumentItem>,
    private readonly aiExtractionService: AIInvoiceExtractionService,
    private readonly supplierMatchingService: SupplierMatchingService,
    private readonly itemMatchingService: ItemMatchingService,
    private readonly validationService: InvoiceValidationService,
    private readonly auditService: AuditService,
  ) {}

  validateUploadedFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    const allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
    const fileExt = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.includes(fileExt) || !allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file format (${fileExt || file.mimetype}). Only PDF, JPG, JPEG, PNG, DOC, and DOCX files are allowed.`
      );
    }

    const maxBytes = 25 * 1024 * 1024; // 25MB
    if (file.size > maxBytes) {
      throw new BadRequestException('File size exceeds 25MB limit.');
    }

    if (file.size === 0) {
      throw new BadRequestException('Uploaded file is empty.');
    }
  }

  async createDocumentRecord(file: Express.Multer.File, user = 'User'): Promise<PurchaseInvoiceDocument> {
    this.validateUploadedFile(file);

    const doc = this.docRepo.create({
      file_name: file.originalname,
      file_type: file.mimetype,
      file_size: file.size,
      file_path: file.path || '',
      file_url: `/uploads/${file.filename}`,
      status: ProcessingStatus.UPLOADED,
      created_by: user,
    });

    const saved = await this.docRepo.save(doc);

    await this.auditService.log(
      'PURCHASE_INVOICE_DOCUMENT',
      saved.id,
      'INVOICE_UPLOADED',
      `File ${file.originalname} uploaded (${(file.size / 1024).toFixed(1)} KB)`,
      { fileName: file.originalname, size: file.size, mimeType: file.mimetype },
      user,
    );

    // Trigger asynchronous background processing pipeline
    this.processDocumentAsync(saved.id).catch((err) => {
      this.logger.error(`Async pipeline error on doc ${saved.id}: ${err.message}`, err.stack);
    });

    return saved;
  }

  async processDocumentAsync(docId: string): Promise<void> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) return;

    try {
      // Stage 1: PROCESSING
      doc.status = ProcessingStatus.PROCESSING;
      await this.docRepo.save(doc);
      await this.auditService.log(
        'PURCHASE_INVOICE_DOCUMENT',
        doc.id,
        'PROCESSING_STARTED',
        'Invoice document queued for OCR and AI analysis'
      );

      // Stage 2: AI EXTRACTION
      const extracted = await this.aiExtractionService.extractInvoiceData(doc.file_path, doc.file_name);
      doc.extracted_data = extracted;
      doc.status = ProcessingStatus.EXTRACTED;
      doc.supplier_name_extracted = extracted.supplier?.name || null;
      doc.invoice_number_extracted = extracted.invoice?.number || null;
      doc.invoice_date_extracted = extracted.invoice?.date || null;
      doc.due_date_extracted = extracted.invoice?.due_date || null;
      doc.currency = extracted.invoice?.currency || 'INR';
      doc.po_number = extracted.invoice?.po_number || null;
      doc.grand_total = extracted.totals?.grand_total || 0;
      doc.tax_amount = extracted.taxes?.total_tax || 0;
      doc.confidence_score = extracted.overall_confidence ? Number((extracted.overall_confidence * 100).toFixed(2)) : 85;
      await this.docRepo.save(doc);

      await this.auditService.log(
        'PURCHASE_INVOICE_DOCUMENT',
        doc.id,
        'AI_EXTRACTION_COMPLETED',
        `Extracted ${extracted.items?.length || 0} line items with confidence ${doc.confidence_score}%`,
        { extractedInvoiceNumber: doc.invoice_number_extracted }
      );

      // Stage 3: MATCHING (Supplier & Items)
      doc.status = ProcessingStatus.MATCHING;
      await this.docRepo.save(doc);

      const supplierMatch = await this.supplierMatchingService.matchSupplier(extracted.supplier);
      doc.supplier_matching_result = supplierMatch;
      if (supplierMatch.matched && supplierMatch.supplier_id) {
        doc.erpnext_supplier_id = supplierMatch.supplier_id;
      }

      await this.auditService.log(
        'PURCHASE_INVOICE_DOCUMENT',
        doc.id,
        'SUPPLIER_MATCHED',
        supplierMatch.matched
          ? `Matched to ERPNext supplier: ${supplierMatch.supplier_name} (${supplierMatch.match_type})`
          : 'Supplier not automatically matched in ERPNext'
      );

      // Match line items
      const processedItems: PurchaseInvoiceDocumentItem[] = [];
      if (extracted.items && extracted.items.length > 0) {
        for (const it of extracted.items) {
          const itemMatch = await this.itemMatchingService.matchItem(it);
          it.matched_erp_item_code = itemMatch.item_code;
          it.matched_erp_item_name = itemMatch.item_name;
          it.match_confidence = itemMatch.confidence;
          it.match_reason = itemMatch.match_reason;
          it.match_status = itemMatch.match_type === 'NONE' ? 'UNMATCHED' : 'MATCHED';

          const docItem = this.docItemRepo.create({
            document_id: doc.id,
            document: doc,
            description_extracted: it.description,
            item_code_extracted: it.item_code,
            erpnext_item_code: itemMatch.item_code || '',
            erpnext_item_name: itemMatch.item_name || '',
            quantity: it.quantity,
            uom: it.uom || itemMatch.uom || 'Nos',
            rate: it.rate,
            discount_percentage: it.discount_percentage || 0,
            discount_amount: it.discount_amount || 0,
            tax_percentage: it.tax_percentage || 18,
            tax_amount: it.tax_amount || 0,
            amount: it.amount || it.quantity * it.rate,
            confidence_score: Number(((it.confidence || 0.9) * 100).toFixed(2)),
            match_status: itemMatch.item_code ? 'MATCHED' : 'UNMATCHED',
            match_reason: itemMatch.match_reason,
          });
          processedItems.push(docItem);
        }
        const savedItems = await this.docItemRepo.save(processedItems);
        doc.items = savedItems;
      }

      // Stage 4: VALIDATION
      doc.status = ProcessingStatus.VALIDATING;
      await this.docRepo.save(doc);

      const validationResult = await this.validationService.validateInvoice(extracted, doc.id);
      doc.validation_result = validationResult;
      doc.normalized_data = extracted;

      // Stage 5: REVIEW_REQUIRED
      doc.status = ProcessingStatus.REVIEW_REQUIRED;
      await this.docRepo.save(doc);

      await this.auditService.log(
        'PURCHASE_INVOICE_DOCUMENT',
        doc.id,
        'VALIDATION_COMPLETED',
        `Validation finished: ${validationResult.errors.length} errors, ${validationResult.warnings.length} warnings. Status moved to REVIEW_REQUIRED.`,
        { validationSummary: validationResult.summary }
      );
    } catch (error: any) {
      this.logger.error(`Error processing document ${doc.id}: ${error.message}`, error.stack);
      doc.status = ProcessingStatus.FAILED;
      doc.error_message = error.message || 'An unexpected error occurred during AI extraction.';
      await this.docRepo.save(doc);

      await this.auditService.log(
        'PURCHASE_INVOICE_DOCUMENT',
        doc.id,
        'PROCESSING_FAILED',
        `Processing failed: ${error.message}`
      );
    }
  }

  async retryProcessing(docId: string): Promise<PurchaseInvoiceDocument> {
    const doc = await this.docRepo.findOne({ where: { id: docId } });
    if (!doc) throw new BadRequestException('Document not found');

    // Clean previous items
    await this.docItemRepo.delete({ document_id: docId });

    doc.status = ProcessingStatus.UPLOADED;
    doc.error_message = null;
    await this.docRepo.save(doc);

    await this.auditService.log(
      'PURCHASE_INVOICE_DOCUMENT',
      doc.id,
      'PROCESSING_RETRY',
      'User initiated processing retry'
    );

    this.processDocumentAsync(doc.id).catch((err) => {
      this.logger.error(`Retry error on doc ${doc.id}: ${err.message}`);
    });

    return doc;
  }
}
