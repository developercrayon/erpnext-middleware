import { ConfidenceLevel, ValidationSeverity } from '../enums/processing-status.enum';

export interface ExtractedSupplier {
  name: string | null;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  confidence?: {
    name?: number;
    gstin?: number;
    overall?: number;
  };
}

export interface ExtractedInvoiceMeta {
  number: string | null;
  date: string | null;
  due_date: string | null;
  currency: string;
  po_number: string | null;
  delivery_note: string | null;
  confidence?: {
    number?: number;
    date?: number;
    due_date?: number;
    po_number?: number;
  };
}

export interface ExtractedAddress {
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
}

export interface ExtractedItem {
  id?: string;
  description: string;
  item_code: string | null;
  hsn_code?: string | null;
  quantity: number;
  uom: string;
  rate: number;
  discount_percentage: number;
  discount_amount: number;
  tax_percentage: number;
  tax_amount: number;
  amount: number;
  confidence?: number;
  matched_erp_item_code?: string | null;
  matched_erp_item_name?: string | null;
  match_confidence?: number;
  match_reason?: string | null;
  match_status?: 'MATCHED' | 'UNMATCHED' | 'MANUAL';
  hsn_matched?: boolean;
}

export interface ExtractedTaxes {
  cgst: number;
  sgst: number;
  igst: number;
  other_tax: number;
  total_tax: number;
}

export interface ExtractedTotals {
  subtotal: number;
  discount: number;
  taxable_amount: number;
  grand_total: number;
}

export interface InvoiceExtractedData {
  supplier: ExtractedSupplier;
  invoice: ExtractedInvoiceMeta;
  billing_address: ExtractedAddress;
  shipping_address: ExtractedAddress;
  items: ExtractedItem[];
  taxes: ExtractedTaxes;
  totals: ExtractedTotals;
  payment_terms: string | null;
  warehouse?: string;
  cost_center?: string;
  notes: string | null;
  raw_text?: string;
  overall_confidence: number;
}

export interface ValidationItem {
  field: string;
  severity: ValidationSeverity;
  message: string;
  expected?: any;
  actual?: any;
}

export interface ValidationResult {
  is_valid: boolean;
  can_proceed_with_warning: boolean;
  errors: ValidationItem[];
  warnings: ValidationItem[];
  info: ValidationItem[];
  summary: {
    total_errors: number;
    total_warnings: number;
    total_info: number;
  };
  calculated_totals?: {
    subtotal: number;
    taxable_amount: number;
    calculated_cgst: number;
    calculated_sgst: number;
    calculated_igst: number;
    total_tax: number;
    grand_total: number;
    difference_from_extracted: number;
  };
}

export interface SupplierMatchResult {
  matched: boolean;
  supplier_id: string | null;
  supplier_name: string | null;
  gstin: string | null;
  match_type: 'EXACT_GSTIN' | 'EXACT_NAME' | 'NORMALIZED_NAME' | 'FUZZY_NAME' | 'NONE';
  confidence: number;
  all_candidates?: Array<{
    supplier_id: string;
    supplier_name: string;
    gstin: string;
    confidence: number;
  }>;
}

export interface ItemMatchResult {
  item_code: string | null;
  item_name: string | null;
  uom?: string;
  confidence: number;
  match_reason: string;
  match_type: 'TITLE_AND_HSN' | 'EXACT_CODE' | 'SUPPLIER_PART_NO' | 'BARCODE' | 'EXACT_NAME' | 'NORMALIZED_NAME' | 'FUZZY' | 'SEMANTIC' | 'NONE';
  candidates?: Array<{
    item_code: string;
    item_name: string;
    confidence: number;
  }>;
}
