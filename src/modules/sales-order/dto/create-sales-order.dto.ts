export class SalesOrderItemDto {
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
  delivery_date?: string;
}

export class CreateSalesOrderDto {
  order_id?: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  customer_gstin?: string;
  billing_address?: string;
  shipping_address?: string;
  order_date?: string; // YYYY-MM-DD
  delivery_date?: string; // YYYY-MM-DD
  po_no?: string;
  currency?: string;
  source?: 'MANUAL' | 'AI_OCR' | 'AI_CHAT' | 'AI_VOICE';
  raw_ai_input?: string;
  items: SalesOrderItemDto[];
  user?: string;
}
