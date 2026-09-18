import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseInvoiceDocument } from '../../database/entities/purchase-invoice-document.entity';
import { PurchaseInvoiceDocumentItem } from '../../database/entities/purchase-invoice-document-item.entity';
import { ProcessingStatus } from '../../common/enums/processing-status.enum';
import { ConfigService } from '@nestjs/config';
import { ErpNextService } from '../purchasing-erpnext/erpnext.service';
import { InvoiceValidationService } from '../validation/invoice-validation.service';
import { AuditService } from '../audit/audit.service';
import { InvoiceExtractedData } from '../../common/interfaces/invoice-schema.interface';

import { CreateManualInvoiceDto } from './dto/create-manual-invoice.dto';

@Injectable()
export class PurchasingService implements OnModuleInit {
  private readonly logger = new Logger(PurchasingService.name);

  constructor(
    @InjectRepository(PurchaseInvoiceDocument)
    private readonly docRepo: Repository<PurchaseInvoiceDocument>,
    @InjectRepository(PurchaseInvoiceDocumentItem)
    private readonly docItemRepo: Repository<PurchaseInvoiceDocumentItem>,
    private readonly configService: ConfigService,
    private readonly erpNextService: ErpNextService,
    private readonly validationService: InvoiceValidationService,
    private readonly auditService: AuditService,
  ) {}

  async onModuleInit() {
    try {
      // Clean up phantom badges from failed documents
      const failedDocs = await this.docRepo.find({ where: { status: ProcessingStatus.FAILED } });
      for (const doc of failedDocs) {
        if (doc.extracted_data && Array.isArray((doc.extracted_data as any).items)) {
          (doc.extracted_data as any).items = (doc.extracted_data as any).items.map((it: any) => ({
            ...it,
            item_code: '',
            matched_erp_item_code: '',
            matched_erp_item_name: '',
          }));
          await this.docRepo.save(doc);
        }
      }
      this.logger.log(`Initialized and cleaned phantom badges from ${failedDocs.length} failed documents.`);
    } catch (e: any) {
      this.logger.warn(`Could not clean failed document badges on startup: ${e.message}`);
    }
  }

  async createManualPurchaseInvoice(
    dto: CreateManualInvoiceDto,
    user = 'User',
  ): Promise<PurchaseInvoiceDocument> {
    this.logger.log(`Creating manual purchase invoice: ${dto.invoice_number} for supplier: ${dto.supplier}`);

    // Calculate line items, taxes, totals
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    const formattedItems = (dto.items || []).map((it) => {
      const gross = Number((it.quantity * it.rate).toFixed(2));
      const disc = Number((it.discount_amount || (gross * (it.discount_percentage || 0)) / 100).toFixed(2));
      const net = Number((gross - disc).toFixed(2));
      const taxRate = it.tax_percentage !== undefined ? it.tax_percentage : 18;
      const tax = Number(((net * taxRate) / 100).toFixed(2));
      const itemAmount = gross;

      subtotal += gross;
      totalDiscount += disc;
      totalTax += tax;

      return {
        description: it.description || it.item_name || it.item_code,
        item_code: it.item_code,
        matched_erp_item_code: it.item_code,
        matched_erp_item_name: it.item_name || it.item_code,
        quantity: it.quantity,
        uom: it.uom || 'Nos',
        rate: it.rate,
        discount_percentage: it.discount_percentage || 0,
        discount_amount: disc,
        tax_percentage: taxRate,
        tax_amount: tax,
        amount: itemAmount,
        confidence: 1.0,
        match_confidence: 1.0,
        match_status: 'MATCHED' as const,
        match_reason: 'Manually selected ERP Item',
      };
    });

    const taxableAmount = Number((subtotal - totalDiscount).toFixed(2));
    const grandTotal = Number((taxableAmount + totalTax).toFixed(2));
    const cgst = Number((totalTax / 2).toFixed(2));
    const sgst = Number((totalTax / 2).toFixed(2));

    const invoiceData: InvoiceExtractedData = {
      supplier: {
        name: dto.supplier,
        gstin: null,
        address: null,
        phone: null,
        email: null,
        confidence: { name: 1.0, overall: 1.0 },
      },
      invoice: {
        number: dto.invoice_number,
        date: dto.posting_date,
        due_date: dto.due_date || dto.posting_date,
        currency: 'INR',
        po_number: dto.po_number || null,
        delivery_note: null,
        confidence: { number: 1.0, date: 1.0 },
      },
      billing_address: {
        address: null,
        city: null,
        state: null,
        postal_code: null,
        country: 'India',
      },
      shipping_address: {
        address: null,
        city: null,
        state: null,
        postal_code: null,
        country: 'India',
      },
      items: formattedItems,
      taxes: {
        cgst,
        sgst,
        igst: 0,
        other_tax: 0,
        total_tax: totalTax,
      },
      totals: {
        subtotal,
        discount: totalDiscount,
        taxable_amount: taxableAmount,
        grand_total: grandTotal,
      },
      payment_terms: dto.payment_terms || 'Net 30',
      notes: dto.remarks || null,
      overall_confidence: 1.0,
    };

    // Pre-validate before creation to catch duplicates and block creation
    const preValidation = await this.validationService.validateInvoice(invoiceData);
    if (!preValidation.is_valid) {
      const duplicateError = preValidation.errors.find((e) => e.field === 'invoice.duplicate');
      if (duplicateError) {
        throw new BadRequestException(duplicateError.message);
      }
    }

    // Create database document record
    const doc = this.docRepo.create({
      file_name: `manual_${dto.invoice_number}.json`,
      file_type: 'application/json',
      file_size: 1024,
      file_path: 'MANUAL_ENTRY',
      file_url: null,
      status: ProcessingStatus.REVIEW_REQUIRED,
      supplier_name_extracted: dto.supplier,
      invoice_number_extracted: dto.invoice_number,
      invoice_date_extracted: dto.posting_date,
      due_date_extracted: dto.due_date || dto.posting_date,
      currency: 'INR',
      po_number: dto.po_number || null,
      grand_total: grandTotal,
      tax_amount: totalTax,
      confidence_score: 100,
      erpnext_supplier_id: dto.supplier,
      extracted_data: invoiceData,
      normalized_data: invoiceData,
      created_by: user,
    });

    const savedDoc = await this.docRepo.save(doc);

    // Save Line items
    const docItems = formattedItems.map((it) =>
      this.docItemRepo.create({
        document_id: savedDoc.id,
        document: savedDoc,
        description_extracted: it.description,
        item_code_extracted: it.item_code,
        erpnext_item_code: it.matched_erp_item_code,
        erpnext_item_name: it.matched_erp_item_name,
        quantity: it.quantity,
        uom: it.uom,
        rate: it.rate,
        discount_percentage: it.discount_percentage,
        discount_amount: it.discount_amount,
        tax_percentage: it.tax_percentage,
        tax_amount: it.tax_amount,
        amount: it.amount,
        confidence_score: 100,
        match_status: 'MATCHED',
        match_reason: 'Manual Entry',
      }),
    );
    savedDoc.items = await this.docItemRepo.save(docItems);

    // Validate
    const validationResult = await this.validationService.validateInvoice(invoiceData, savedDoc.id);
    savedDoc.validation_result = validationResult;
    await this.docRepo.save(savedDoc);

    await this.auditService.log(
      'PURCHASE_INVOICE_DOCUMENT',
      savedDoc.id,
      'MANUAL_INVOICE_CREATED',
      `Manual Purchase Invoice ${dto.invoice_number} created for supplier ${dto.supplier} with total ₹${grandTotal.toLocaleString()}`,
      { invoiceNumber: dto.invoice_number, supplier: dto.supplier, total: grandTotal },
      user,
    );

    if (dto.submit_to_erp) {
      return this.approveAndCreateInErp(savedDoc.id, user);
    }

    return savedDoc;
  }

  async getAllInvoices(statusFilter?: string, search?: string): Promise<PurchaseInvoiceDocument[]> {
    const query = this.docRepo.createQueryBuilder('doc')
      .leftJoinAndSelect('doc.items', 'items')
      .orderBy('doc.created_at', 'DESC');

    if (statusFilter && statusFilter !== 'ALL') {
      query.andWhere('doc.status = :status', { status: statusFilter });
    }

    if (search && search.trim()) {
      query.andWhere(
        '(LOWER(doc.supplier_name_extracted) LIKE :s OR LOWER(doc.invoice_number_extracted) LIKE :s OR LOWER(doc.file_name) LIKE :s)',
        { s: `%${search.toLowerCase()}%` },
      );
    }

    return query.getMany();
  }

  async getInvoiceById(id: string): Promise<PurchaseInvoiceDocument> {
    const doc = await this.docRepo.findOne({
      where: { id },
      relations: ['items'],
    });
    if (!doc) throw new NotFoundException(`Invoice document with ID ${id} not found.`);
    return doc;
  }

  async getProcessingStatus(id: string): Promise<{
    id: string;
    status: ProcessingStatus;
    confidence: number;
    error_message?: string;
    erpnext_invoice_id?: string;
    items_count: number;
  }> {
    const doc = await this.getInvoiceById(id);
    return {
      id: doc.id,
      status: doc.status,
      confidence: Number(doc.confidence_score) || 0,
      error_message: doc.error_message,
      erpnext_invoice_id: doc.erpnext_invoice_id,
      items_count: doc.items?.length || 0,
    };
  }

  async updateInvoiceData(
    id: string,
    updatedData: Partial<InvoiceExtractedData>,
    user = 'User',
  ): Promise<PurchaseInvoiceDocument> {
    const doc = await this.getInvoiceById(id);

    // Merge modifications into normalized_data
    const currentData = (doc.normalized_data || doc.extracted_data) as InvoiceExtractedData;
    const mergedData: InvoiceExtractedData = {
      ...currentData,
      ...updatedData,
      supplier: {
        ...currentData.supplier,
        ...(updatedData.supplier || {}),
      },
      invoice: {
        ...currentData.invoice,
        ...(updatedData.invoice || {}),
      },
      items: updatedData.items || currentData.items,
      taxes: {
        ...currentData.taxes,
        ...(updatedData.taxes || {}),
      },
      totals: {
        ...currentData.totals,
        ...(updatedData.totals || {}),
      },
    };

    doc.supplier_name_extracted = mergedData.supplier?.name !== undefined ? mergedData.supplier.name : doc.supplier_name_extracted;
    doc.invoice_number_extracted = mergedData.invoice?.number !== undefined ? mergedData.invoice.number : doc.invoice_number_extracted;
    doc.invoice_date_extracted = mergedData.invoice?.date !== undefined ? mergedData.invoice.date : doc.invoice_date_extracted;
    doc.due_date_extracted = mergedData.invoice?.due_date !== undefined ? mergedData.invoice.due_date : doc.due_date_extracted;
    doc.po_number = mergedData.invoice?.po_number !== undefined ? mergedData.invoice.po_number : doc.po_number;
    doc.grand_total = mergedData.totals?.grand_total || doc.grand_total;
    doc.tax_amount = mergedData.taxes?.total_tax || doc.tax_amount;
    doc.normalized_data = mergedData;

    // Update line items in database
    if (updatedData.items && Array.isArray(updatedData.items)) {
      await this.docItemRepo.delete({ document_id: doc.id });
      const newItems = updatedData.items.map((it) =>
        this.docItemRepo.create({
          document_id: doc.id,
          document: doc,
          description_extracted: it.description,
          item_code_extracted: it.item_code,
          erpnext_item_code: it.matched_erp_item_code || '',
          erpnext_item_name: it.matched_erp_item_name || '',
          quantity: it.quantity,
          uom: it.uom || 'Nos',
          rate: it.rate,
          discount_percentage: it.discount_percentage || 0,
          discount_amount: it.discount_amount || 0,
          tax_percentage: it.tax_percentage || 0,
          tax_amount: it.tax_amount || 0,
          amount: it.amount || it.quantity * it.rate,
          confidence_score: 100, // manual edit = 100% confidence
          match_status: it.matched_erp_item_code ? 'MATCHED' : 'UNMATCHED',
          match_reason: it.match_reason || 'User manual assignment',
        }),
      );
      doc.items = await this.docItemRepo.save(newItems);
    }

    // Re-run validation
    const validationResult = await this.validationService.validateInvoice(mergedData, doc.id);
    doc.validation_result = validationResult;
    doc.error_message = null;

    const saved = await this.docRepo.save(doc);

    await this.auditService.log(
      'PURCHASE_INVOICE_DOCUMENT',
      doc.id,
      'USER_EDITED_INVOICE',
      `User updated invoice fields and items. Validation: ${validationResult.errors.length} errors, ${validationResult.warnings.length} warnings.`,
      { updatedData },
      user,
    );

    return saved;
  }

  async validateInvoiceExplicit(id: string): Promise<PurchaseInvoiceDocument> {
    const doc = await this.getInvoiceById(id);
    const data = (doc.normalized_data || doc.extracted_data) as InvoiceExtractedData;
    const validation = await this.validationService.validateInvoice(data, doc.id);
    doc.validation_result = validation;
    return this.docRepo.save(doc);
  }

  async approveAndCreateInErp(id: string, user = 'User'): Promise<PurchaseInvoiceDocument> {
    const doc = await this.getInvoiceById(id);

    // Idempotency: Prevent duplicate submissions if already CREATED
    if (doc.status === ProcessingStatus.CREATED && doc.erpnext_invoice_id) {
      throw new BadRequestException(
        `This invoice has already been created in ERPNext (Ref: ${doc.erpnext_invoice_id}).`,
      );
    }

    if (doc.status === ProcessingStatus.CREATING) {
      throw new BadRequestException('ERPNext invoice creation is currently in progress.');
    }

    // Validate rules before creation (Section 32)
    const data = (doc.normalized_data || doc.extracted_data) as InvoiceExtractedData;
    const validation = await this.validationService.validateInvoice(data, doc.id);
    doc.validation_result = validation;

    // Block if any blocking validation errors exist (e.g. duplicate, missing required item_code/hsn on new items, missing mandatory GSTIN on tax invoices)
    if (validation.errors && validation.errors.length > 0) {
      const errorMsgs = validation.errors.map((e) => e.message).join(' | ');
      throw new BadRequestException(
        `Cannot sync to ERPNext. Please resolve the following validation errors: ${errorMsgs}`,
      );
    }

    // Stage: APPROVED -> CREATING
    doc.status = ProcessingStatus.APPROVED;
    await this.docRepo.save(doc);

    await this.auditService.log(
      'PURCHASE_INVOICE_DOCUMENT',
      doc.id,
      'USER_APPROVED_INVOICE',
      `Invoice approved by user for ERPNext synchronization`,
      null,
      user,
    );

    doc.status = ProcessingStatus.CREATING;
    await this.docRepo.save(doc);

    await this.auditService.log(
      'PURCHASE_INVOICE_DOCUMENT',
      doc.id,
      'ERPNEXT_CREATION_STARTED',
      `Initiating ERPNext Purchase Invoice API call`,
    );

    // STEP 1: Ensure/Create ALL Line Items in ERPNext first
    const items = [];
    for (const it of data.items) {
      const rawCode = (it.matched_erp_item_code || it.item_code || it.description || 'Product Item').trim();
      const itemName = (it.matched_erp_item_name || it.description || rawCode).trim();
      const itemUom = (it.uom || 'Nos').trim();
      const hsnCode = ((it as any).gst_hsn_code || (it as any).hsn_code || '').trim();
      
      let finalItemCode = rawCode;
      try {
        finalItemCode = await this.erpNextService.ensureItemExists(
          rawCode,
          itemName,
          itemUom,
          hsnCode,
          Number(it.rate) || 0,
        );
      } catch (itemErr: any) {
        this.logger.error(`Error ensuring item ${rawCode} in ERPNext: ${itemErr.message}`);
        throw new BadRequestException(`Failed to register item '${rawCode}' in ERPNext: ${itemErr.message}`);
      }

      items.push({
        item_code: finalItemCode || 'Product Item',
        item_name: itemName,
        description: it.description || itemName,
        qty: Number(it.quantity) || 1,
        uom: itemUom,
        rate: Number(it.rate) || 0,
        amount: Number(it.amount) || Number(it.quantity) * Number(it.rate),
      });
    }

    // STEP 2: Ensure/Create Supplier in ERPNext
    let supplierName = (doc.erpnext_supplier_id || data.supplier?.name || 'FILIPX INDIA').trim();
    try {
      supplierName = await this.erpNextService.ensureSupplierExists(
        supplierName,
        data.supplier?.gstin || (doc.extracted_data as any)?.supplier?.gstin,
      );
      doc.erpnext_supplier_id = supplierName;
    } catch (supErr: any) {
      this.logger.warn(`Could not verify/create supplier in ERPNext: ${supErr.message}`);
      throw new BadRequestException(`Failed to register supplier '${supplierName}' in ERPNext: ${supErr.message}`);
    }

    // STEP 3: Build and submit Purchase Invoice to ERPNext
    const defaultCompany = this.configService.get<string>('ERPNEXT_COMPANY', 'Woodwolf Studio (O) Pvt. Ltd');
    const defaultWarehouse = this.configService.get<string>('ERPNEXT_DEFAULT_WAREHOUSE', 'Stores - woodwolf');
    const defaultCostCenter = this.configService.get<string>('ERPNEXT_DEFAULT_COST_CENTER', 'Main - woodwolf');
    const taxAccountCgst = this.configService.get<string>('ERPNEXT_TAX_ACCOUNT_CGST', 'Input Tax CGST - woodwolf');
    const taxAccountSgst = this.configService.get<string>('ERPNEXT_TAX_ACCOUNT_SGST', 'Input Tax SGST - woodwolf');
    const taxAccountIgst = this.configService.get<string>('ERPNEXT_TAX_ACCOUNT_IGST', 'Input Tax IGST - woodwolf');

    const resolvedWarehouse = (data.warehouse || defaultWarehouse).trim();

    const sGstin = (data.supplier?.gstin || (doc.extracted_data as any)?.supplier?.gstin || '').trim();
    const hasGstin = sGstin.length >= 2;
    const isInterState = hasGstin && sGstin.substring(0, 2) !== '24';

    const taxes = [];
    if (hasGstin) {
      if (isInterState) {
        const igstAmount = data.taxes?.igst > 0
          ? data.taxes.igst
          : ((Number(data.taxes?.cgst) || 0) + (Number(data.taxes?.sgst) || 0) || Number(data.taxes?.total_tax) || 0);

        if (igstAmount > 0) {
          taxes.push({
            charge_type: 'On Net Total',
            account_head: taxAccountIgst,
            rate: 18,
            tax_amount: igstAmount,
            description: 'IGST 18%',
          });
        }
      } else {
        if (data.taxes?.cgst > 0) {
          taxes.push({
            charge_type: 'On Net Total',
            account_head: taxAccountCgst,
            rate: 9,
            tax_amount: data.taxes.cgst,
            description: 'CGST 9%',
          });
        }
        if (data.taxes?.sgst > 0) {
          taxes.push({
            charge_type: 'On Net Total',
            account_head: taxAccountSgst,
            rate: 9,
            tax_amount: data.taxes.sgst,
            description: 'SGST 9%',
          });
        }
        if (taxes.length === 0 && data.taxes?.igst > 0) {
          taxes.push({
            charge_type: 'On Net Total',
            account_head: taxAccountIgst,
            rate: 18,
            tax_amount: data.taxes.igst,
            description: 'IGST 18%',
          });
        }
      }
    }

    const erpResult = await this.erpNextService.createPurchaseInvoice({
      doctype: 'Purchase Invoice',
      company: defaultCompany,
      supplier: supplierName,
      posting_date: data.invoice?.date || new Date().toISOString().split('T')[0],
      due_date: data.invoice?.due_date || data.invoice?.date,
      bill_no: data.invoice?.number || `BILL-${Date.now()}`,
      bill_date: data.invoice?.date,
      set_warehouse: resolvedWarehouse,
      cost_center: data.cost_center || defaultCostCenter,
      remarks: `Created via AI Purchasing Module from upload: ${doc.file_name}`,
      items: items.map((it) => ({
        ...it,
        warehouse: resolvedWarehouse,
        cost_center: data.cost_center || defaultCostCenter,
      })),
      taxes,
    });

    if (erpResult.success && erpResult.erpnext_invoice_id) {
      doc.status = ProcessingStatus.CREATED;
      doc.erpnext_invoice_id = erpResult.erpnext_invoice_id;
      doc.erpnext_response = erpResult.raw_response;
      doc.error_message = null;
      await this.docRepo.save(doc);

      await this.auditService.log(
        'PURCHASE_INVOICE_DOCUMENT',
        doc.id,
        'ERPNEXT_INVOICE_CREATED',
        `Successfully created Purchase Invoice in ERPNext: ${erpResult.erpnext_invoice_id}`,
        { erpnextInvoiceId: erpResult.erpnext_invoice_id },
        user,
      );
    } else {
      doc.status = ProcessingStatus.FAILED;
      doc.error_message = erpResult.user_friendly_error || erpResult.error_message || 'ERPNext rejected creation.';
      doc.erpnext_response = erpResult.raw_response;
      await this.docRepo.save(doc);

      await this.auditService.log(
        'PURCHASE_INVOICE_DOCUMENT',
        doc.id,
        'ERPNEXT_CREATION_FAILED',
        `ERPNext creation failed: ${doc.error_message}`,
        { errorDetails: erpResult.raw_response },
        user,
      );

      throw new BadRequestException(doc.error_message);
    }

    return doc;
  }

  async deleteInvoice(id: string): Promise<{ success: boolean }> {
    const doc = await this.getInvoiceById(id);
    await this.docItemRepo.delete({ document_id: id });
    await this.docRepo.delete(id);
    await this.auditService.log('PURCHASE_INVOICE_DOCUMENT', id, 'INVOICE_DELETED', `Invoice ${doc.file_name} deleted`);
    return { success: true };
  }

  async getDashboardStats() {
    const totalCount = await this.docRepo.count();
    const pendingReview = await this.docRepo.count({ where: { status: ProcessingStatus.REVIEW_REQUIRED } });
    const createdInErp = await this.docRepo.count({ where: { status: ProcessingStatus.CREATED } });
    const failed = await this.docRepo.count({ where: { status: ProcessingStatus.FAILED } });
    const processing = await this.docRepo.count({ where: { status: ProcessingStatus.PROCESSING } });

    const totalValueResult = await this.docRepo
      .createQueryBuilder('doc')
      .select('SUM(doc.grand_total)', 'total')
      .where('doc.status = :status', { status: ProcessingStatus.CREATED })
      .getRawOne();

    const avgConfidenceResult = await this.docRepo
      .createQueryBuilder('doc')
      .select('AVG(doc.confidence_score)', 'avg')
      .getRawOne();

    return {
      total_invoices: totalCount,
      pending_review: pendingReview,
      synced_erpnext: createdInErp,
      failed_processing: failed,
      active_processing: processing,
      total_synced_value: Number(totalValueResult?.total) || 0,
      average_confidence: Number(Number(avgConfidenceResult?.avg || 92).toFixed(1)),
      erp_status: this.erpNextService.getStatus(),
    };
  }
}
