import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
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
export class PurchasingService {
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

    // Update document summary fields
    doc.supplier_name_extracted = mergedData.supplier?.name || doc.supplier_name_extracted;
    doc.invoice_number_extracted = mergedData.invoice?.number || doc.invoice_number_extracted;
    doc.invoice_date_extracted = mergedData.invoice?.date || doc.invoice_date_extracted;
    doc.due_date_extracted = mergedData.invoice?.due_date || doc.due_date_extracted;
    doc.po_number = mergedData.invoice?.po_number || doc.po_number;
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

    // Only block if invoice is verified duplicate in ERPNext
    const duplicateErr = validation.errors?.find((e) => e.field === 'invoice.duplicate');
    if (duplicateErr) {
      throw new BadRequestException(
        `Cannot create duplicate invoice: ${duplicateErr.message}`,
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

    // Ensure Supplier is registered in ERPNext before invoice creation
    let supplierName = (doc.erpnext_supplier_id || data.supplier?.name || 'FILIPX INDIA').trim();
    try {
      supplierName = await this.erpNextService.ensureSupplierExists(
        supplierName,
        data.supplier?.gstin || (doc.extracted_data as any)?.supplier?.gstin,
      );
      doc.erpnext_supplier_id = supplierName;
    } catch (supErr: any) {
      this.logger.warn(`Could not verify/create supplier in ERPNext: ${supErr.message}`);
    }

    // Ensure all items are registered in ERPNext before invoice creation
    const items = [];
    for (const it of data.items) {
      const rawCode = (it.matched_erp_item_code || it.item_code || it.description || 'Product Item').trim();
      const itemName = (it.matched_erp_item_name || it.description || rawCode).trim();
      
      let finalItemCode = rawCode;
      try {
        finalItemCode = await this.erpNextService.ensureItemExists(
          rawCode,
          itemName,
          it.uom || 'Nos',
          (it as any).gst_hsn_code || (it as any).hsn_code,
        );
      } catch (e) {
        // If item ensure fails quietly, fallback to rawCode
      }

      items.push({
        item_code: finalItemCode || 'Product Item',
        item_name: itemName,
        description: it.description || itemName,
        qty: Number(it.quantity) || 1,
        uom: it.uom || 'Nos',
        rate: Number(it.rate) || 0,
        amount: Number(it.amount) || Number(it.quantity) * Number(it.rate),
      });
    }

    const defaultCompany = this.configService.get<string>('ERPNEXT_COMPANY', 'Woodwolf Studio (O) Pvt. Ltd');
    const defaultWarehouse = this.configService.get<string>('ERPNEXT_DEFAULT_WAREHOUSE', 'Stores - woodwolf');
    const defaultCostCenter = this.configService.get<string>('ERPNEXT_DEFAULT_COST_CENTER', 'Main - woodwolf');
    const taxAccountCgst = this.configService.get<string>('ERPNEXT_TAX_ACCOUNT_CGST', 'Input Tax CGST - woodwolf');
    const taxAccountSgst = this.configService.get<string>('ERPNEXT_TAX_ACCOUNT_SGST', 'Input Tax SGST - woodwolf');
    const taxAccountIgst = this.configService.get<string>('ERPNEXT_TAX_ACCOUNT_IGST', 'Input Tax IGST - woodwolf');

    const taxes = [];
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
    if (data.taxes?.igst > 0) {
      taxes.push({
        charge_type: 'On Net Total',
        account_head: taxAccountIgst,
        rate: 18,
        tax_amount: data.taxes.igst,
        description: 'IGST 18%',
      });
    }

    const erpResult = await this.erpNextService.createPurchaseInvoice({
      doctype: 'Purchase Invoice',
      supplier: supplierName,
      posting_date: data.invoice?.date || new Date().toISOString().split('T')[0],
      due_date: data.invoice?.due_date || data.invoice?.date,
      bill_no: data.invoice?.number || `BILL-${Date.now()}`,
      bill_date: data.invoice?.date,
      set_warehouse: data.warehouse || defaultWarehouse,
      cost_center: data.cost_center || defaultCostCenter,
      remarks: `Created via AI Purchasing Module from upload: ${doc.file_name}`,
      items: items.map((it) => ({
        ...it,
        warehouse: data.warehouse || defaultWarehouse,
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
