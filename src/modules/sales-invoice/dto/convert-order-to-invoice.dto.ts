export class ConvertOrderToInvoiceDto {
  sales_order_id: string;
  posting_date?: string;
  due_date?: string;
  payment_terms?: string;
  update_stock?: boolean;
  user?: string;
}

export class UpdateSalesInvoiceDto {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_gstin?: string;
  billing_address?: string;
  shipping_address?: string;
  posting_date?: string;
  due_date?: string;
  payment_terms?: string;
  status?: string;
  user?: string;
}
