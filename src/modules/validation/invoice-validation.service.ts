import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  InvoiceExtractedData,
  ValidationResult,
  ValidationItem,
} from '../../common/interfaces/invoice-schema.interface';
import { ValidationSeverity } from '../../common/enums/processing-status.enum';
import { PurchaseInvoiceDocument } from '../../database/entities/purchase-invoice-document.entity';

@Injectable()
export class InvoiceValidationService {
  private readonly logger = new Logger(InvoiceValidationService.name);

  constructor(
    @InjectRepository(PurchaseInvoiceDocument)
    private readonly invoiceDocRepo: Repository<PurchaseInvoiceDocument>,
  ) {}

  async validateInvoice(
    data: InvoiceExtractedData,
    currentDocumentId?: string,
  ): Promise<ValidationResult> {
    const errors: ValidationItem[] = [];
    const warnings: ValidationItem[] = [];
    const info: ValidationItem[] = [];

    // 1. Mandatory Fields Validation (Section 31 & 32)
    if (!data.supplier?.name && !data.supplier?.gstin) {
      errors.push({
        field: 'supplier',
        severity: ValidationSeverity.ERROR,
        message: 'Supplier name is missing. A valid supplier must be provided.',
      });
    }

    const totalTaxExtracted = Number(data.taxes?.total_tax || 0);
    const hasItemsWithTax = data.items?.some(
      (it) => (Number(it.tax_percentage) || 0) > 0 || (Number(it.tax_amount) || 0) > 0,
    );
    const isTaxCharged = totalTaxExtracted > 0 || hasItemsWithTax;

    if (data.supplier?.gstin) {
      const gstinClean = data.supplier.gstin.trim().toUpperCase();
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (gstinClean.length === 15 && !gstinRegex.test(gstinClean)) {
        warnings.push({
          field: 'supplier.gstin',
          severity: ValidationSeverity.WARNING,
          message: `GSTIN "${gstinClean}" does not strictly match the 15-character Indian GSTIN format. Please verify supplier GSTIN.`,
        });
      }
    } else if (isTaxCharged) {
      // If GST is charged on invoice, GSTIN is mandatory
      errors.push({
        field: 'supplier.gstin',
        severity: ValidationSeverity.ERROR,
        message: 'Tax is charged on this invoice. A valid 15-character Supplier GSTIN is mandatory.',
      });
    } else {
      // If NO tax is charged and NO GSTIN is provided, treat as Unregistered supplier (ALLOWED without blocking)
      info.push({
        field: 'supplier.gstin',
        severity: ValidationSeverity.INFO,
        message: 'No GSTIN provided and 0% tax detected. Invoice will be processed as an Unregistered / Non-GST purchase.',
      });
    }

    if (!data.invoice?.number || !data.invoice.number.trim()) {
      errors.push({
        field: 'invoice.number',
        severity: ValidationSeverity.ERROR,
        message: 'Invoice Number is mandatory.',
      });
    }

    if (!data.invoice?.date) {
      errors.push({
        field: 'invoice.date',
        severity: ValidationSeverity.ERROR,
        message: 'Invoice Date is mandatory.',
      });
    } else {
      const invDate = new Date(data.invoice.date);
      if (isNaN(invDate.getTime())) {
        errors.push({
          field: 'invoice.date',
          severity: ValidationSeverity.ERROR,
          message: 'Invoice Date format is invalid.',
        });
      }
    }

    // 2. Line Items Validation
    if (!data.items || data.items.length === 0) {
      errors.push({
        field: 'items',
        severity: ValidationSeverity.ERROR,
        message: 'Invoice must contain at least one line item.',
      });
    } else {
      data.items.forEach((item, idx) => {
        const itemIdx = idx + 1;
        const isLinkedToErp = Boolean(item.matched_erp_item_code && item.matched_erp_item_code.trim());
        const effectiveItemCode = (item.matched_erp_item_code || item.item_code || '').trim();
        const effectiveHsn = ((item as any).gst_hsn_code || (item as any).hsn_code || '').trim();

        if (!isLinkedToErp) {
          // If not linked to an existing ERP item, item_code (SKU) and hsn_code are MANDATORY
          if (!effectiveItemCode) {
            errors.push({
              field: `items[${idx}].item_code`,
              severity: ValidationSeverity.ERROR,
              message: `Item #${itemIdx} (${item.description || 'New Item'}) is a new item and requires an Item Code (SKU).`,
            });
          }

          if (!effectiveHsn) {
            errors.push({
              field: `items[${idx}].hsn_code`,
              severity: ValidationSeverity.ERROR,
              message: `Item #${itemIdx} (${item.description || 'New Item'}) is a new item and requires a GST HSN Code.`,
            });
          } else if (!/^\d{4,8}$/.test(effectiveHsn)) {
            warnings.push({
              field: `items[${idx}].hsn_code`,
              severity: ValidationSeverity.WARNING,
              message: `Item #${itemIdx} HSN code "${effectiveHsn}" should ideally be 4, 6, or 8 numeric digits.`,
            });
          }
        }

        if (isLinkedToErp) {
          if (item.match_reason && item.match_reason.includes('HSN differs')) {
            warnings.push({
              field: `items[${idx}].hsn_code`,
              severity: ValidationSeverity.WARNING,
              message: `Item #${itemIdx} ("${item.description}") matched ERP item (${item.matched_erp_item_code}), but HSN differs (${item.match_reason}).`,
            });
          } else if (item.match_confidence && item.match_confidence < 0.75) {
            warnings.push({
              field: `items[${idx}].match_confidence`,
              severity: ValidationSeverity.WARNING,
              message: `Item #${itemIdx} has low matching confidence (${Math.round(item.match_confidence * 100)}%). Please review ERP item selection.`,
            });
          }
        }

        if (item.quantity <= 0) {
          errors.push({
            field: `items[${idx}].quantity`,
            severity: ValidationSeverity.ERROR,
            message: `Item #${itemIdx} quantity must be greater than zero (found: ${item.quantity}).`,
          });
        }

        if (item.rate < 0) {
          errors.push({
            field: `items[${idx}].rate`,
            severity: ValidationSeverity.ERROR,
            message: `Item #${itemIdx} unit rate cannot be negative.`,
          });
        }
      });
    }

    // 3. Mathematical Recalculation & Indian GST Validation (Section 14 & 15)
    let calculatedSubtotal = 0;
    let calculatedTotalDiscount = 0;
    let calculatedTotalTax = 0;

    data.items.forEach((item) => {
      const itemGross = Number((item.quantity * item.rate).toFixed(2));
      const itemDisc = Number(
        (item.discount_amount || (itemGross * (item.discount_percentage || 0)) / 100).toFixed(2)
      );
      const itemNet = Number((itemGross - itemDisc).toFixed(2));
      const itemTax = Number(
        (item.tax_amount || (itemNet * (item.tax_percentage || 0)) / 100).toFixed(2)
      );

      calculatedSubtotal += itemGross;
      calculatedTotalDiscount += itemDisc;
      calculatedTotalTax += itemTax;
    });

    const calculatedTaxableAmount = Number((calculatedSubtotal - calculatedTotalDiscount).toFixed(2));
    let calculatedCgst = 0;
    let calculatedSgst = 0;
    let calculatedIgst = 0;

    // Detect CGST+SGST vs IGST
    if (data.taxes?.igst && data.taxes.igst > 0) {
      calculatedIgst = calculatedTotalTax;
    } else {
      calculatedCgst = Number((calculatedTotalTax / 2).toFixed(2));
      calculatedSgst = Number((calculatedTotalTax / 2).toFixed(2));
    }

    const calculatedGrandTotal = Number((calculatedTaxableAmount + calculatedTotalTax).toFixed(2));
    const extractedGrandTotal = Number(data.totals?.grand_total || 0);
    const totalDifference = Number(Math.abs(calculatedGrandTotal - extractedGrandTotal).toFixed(2));

    const tolerance = 1.0; // ₹1.00 rounding tolerance

    if (totalDifference > 50.0) {
      // Large discrepancy is a warning that requires user review/confirmation
      warnings.push({
        field: 'totals.grand_total',
        severity: ValidationSeverity.WARNING,
        message: `Invoice Grand Total variance: AI extracted ₹${extractedGrandTotal.toLocaleString()}, while calculated sum is ₹${calculatedGrandTotal.toLocaleString()} (difference: ₹${totalDifference.toFixed(2)}). Please review items before approval.`,
        expected: calculatedGrandTotal,
        actual: extractedGrandTotal,
      });
    } else if (totalDifference > tolerance) {
      warnings.push({
        field: 'totals.grand_total',
        severity: ValidationSeverity.WARNING,
        message: `Invoice Grand Total variance of ₹${totalDifference.toFixed(2)} detected (AI extracted ₹${extractedGrandTotal.toLocaleString()} vs sum ₹${calculatedGrandTotal.toLocaleString()}).`,
        expected: calculatedGrandTotal,
        actual: extractedGrandTotal,
      });
    } else if (totalDifference > 0) {
      info.push({
        field: 'totals.grand_total',
        severity: ValidationSeverity.INFO,
        message: `Minor rounding difference of ₹${totalDifference.toFixed(2)} detected.`,
      });
    }

    // 4. Duplicate Invoice Detection (Same Supplier + Invoice Number OR Same Date + Same Supplier + Same Items/Total)
    const supplierName = data.supplier?.name?.trim();
    const invoiceNumber = data.invoice?.number?.trim();
    const invoiceDate = data.invoice?.date ? String(data.invoice.date).trim() : '';

    // Check Case A: Same Supplier + Same Invoice Number
    if (supplierName && invoiceNumber) {
      const existingSameNum = await this.invoiceDocRepo
        .createQueryBuilder('doc')
        .where('LOWER(TRIM(doc.supplier_name_extracted)) = LOWER(TRIM(:supplier))', { supplier: supplierName })
        .andWhere('LOWER(TRIM(doc.invoice_number_extracted)) = LOWER(TRIM(:invNum))', { invNum: invoiceNumber })
        .andWhere(currentDocumentId ? 'doc.id != :currentDocId' : '1=1', { currentDocId: currentDocumentId })
        .getOne();

      if (existingSameNum) {
        errors.push({
          field: 'invoice.duplicate',
          severity: ValidationSeverity.ERROR,
          message: `Duplicate Invoice Detected: Supplier "${supplierName}" with Invoice #${invoiceNumber} already exists in the system (Ref: ${existingSameNum.erpnext_invoice_id || existingSameNum.file_name || existingSameNum.id}). Creation is disabled to prevent duplicate entries.`,
        });
        warnings.push({
          field: 'invoice.duplicate',
          severity: ValidationSeverity.WARNING,
          message: `Warning: Duplicate invoice #${invoiceNumber} from "${supplierName}" detected (Ref: ${existingSameNum.erpnext_invoice_id || existingSameNum.id}). Creation disabled.`,
        });
      }
    }

    // Check Case B: Same Date + Same Supplier + Same Items / Total
    if (supplierName && invoiceDate && data.items && data.items.length > 0) {
      const candidateDocs = await this.invoiceDocRepo
        .createQueryBuilder('doc')
        .where('LOWER(TRIM(doc.supplier_name_extracted)) = LOWER(TRIM(:supplier))', { supplier: supplierName })
        .andWhere('doc.invoice_date_extracted = :invDate', { invDate: invoiceDate })
        .andWhere(currentDocumentId ? 'doc.id != :currentDocId' : '1=1', { currentDocId: currentDocumentId })
        .getMany();

      for (const candidate of candidateDocs) {
        // Skip if already handled by Case A
        if (invoiceNumber && candidate.invoice_number_extracted && candidate.invoice_number_extracted.trim().toLowerCase() === invoiceNumber.toLowerCase()) {
          continue;
        }

        const candidateData = (candidate.normalized_data || candidate.extracted_data) as InvoiceExtractedData;
        const candidateItems = candidateData?.items || [];
        const candidateTotal = Number(candidate.grand_total || candidateData?.totals?.grand_total || 0);
        const totalMatches = Math.abs(candidateTotal - calculatedGrandTotal) <= 1.0;
        const itemsMatch = this.checkIfItemsMatch(data.items, candidateItems);

        if (totalMatches && itemsMatch) {
          errors.push({
            field: 'invoice.duplicate',
            severity: ValidationSeverity.ERROR,
            message: `Duplicate Invoice Detected: An identical invoice for supplier "${supplierName}" on date ${invoiceDate} with matching items and total ₹${calculatedGrandTotal.toLocaleString()} already exists (Ref: ${candidate.erpnext_invoice_id || candidate.file_name || candidate.id}). Creation is disabled to prevent duplicate billing.`,
          });
          warnings.push({
            field: 'invoice.duplicate',
            severity: ValidationSeverity.WARNING,
            message: `Warning: Same date (${invoiceDate}), same supplier ("${supplierName}"), and identical items/amount found in existing invoice ${candidate.erpnext_invoice_id || candidate.id}. Creation disabled.`,
          });
          break;
        }
      }
    }

    // 5. Information Notices
    if (data.invoice?.po_number) {
      info.push({
        field: 'invoice.po_number',
        severity: ValidationSeverity.INFO,
        message: `Referenced Purchase Order: ${data.invoice.po_number}`,
      });
    }

    if (data.payment_terms) {
      info.push({
        field: 'payment_terms',
        severity: ValidationSeverity.INFO,
        message: `Payment Terms: ${data.payment_terms}`,
      });
    }

    const isValid = errors.length === 0;

    return {
      is_valid: isValid,
      can_proceed_with_warning: isValid && warnings.length > 0,
      errors,
      warnings,
      info,
      summary: {
        total_errors: errors.length,
        total_warnings: warnings.length,
        total_info: info.length,
      },
      calculated_totals: {
        subtotal: calculatedSubtotal,
        taxable_amount: calculatedTaxableAmount,
        calculated_cgst: calculatedCgst,
        calculated_sgst: calculatedSgst,
        calculated_igst: calculatedIgst,
        total_tax: calculatedTotalTax,
        grand_total: calculatedGrandTotal,
        difference_from_extracted: totalDifference,
      },
    };
  }

  private checkIfItemsMatch(itemsA: any[], itemsB: any[]): boolean {
    if (!itemsA || !itemsB || itemsA.length === 0 || itemsB.length === 0) return false;
    if (itemsA.length !== itemsB.length) return false;

    const norm = (it: any) => ({
      desc: (it.description || it.item_name || it.item_code || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''),
      code: (it.matched_erp_item_code || it.item_code || '').trim().toLowerCase(),
      qty: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
    });

    const listA = itemsA.map(norm);
    const listB = itemsB.map(norm);

    return listA.every((itemA) =>
      listB.some((itemB) =>
        (itemA.code && itemB.code && itemA.code === itemB.code && itemA.qty === itemB.qty) ||
        (itemA.desc && itemB.desc && itemA.desc === itemB.desc && itemA.qty === itemB.qty) ||
        (itemA.qty === itemB.qty && Math.abs(itemA.rate - itemB.rate) < 0.1 && Boolean(itemA.desc) && Boolean(itemB.desc) && (itemA.desc.includes(itemB.desc) || itemB.desc.includes(itemA.desc)))
      )
    );
  }
}
