export class SalesInvoiceItemDto {
  item_code: string;
  item_name?: string;
  description?: string;
  hsn_code?: string;
  qty: number;
  uom?: string;
  rate: number;
  discount_percentage?: number;
  discount_amount?: number;
  tax_percentage?: number;
  warehouse?: string;
  cost_center?: string;
}

export class CreateSalesInvoiceDto {
  invoice_number?: string;
  sales_order_id?: string;
  erpnext_so_id?: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  customer_gstin?: string;
  billing_address?: string;
  shipping_address?: string;
  posting_date?: string; // YYYY-MM-DD
  due_date?: string; // YYYY-MM-DD
  payment_terms?: string;
  currency?: string;
  update_stock?: boolean;
  items: SalesInvoiceItemDto[];
  user?: string;
}
