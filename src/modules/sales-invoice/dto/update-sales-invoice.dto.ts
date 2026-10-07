import { SalesInvoiceItemDto } from './create-sales-invoice.dto';

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
  items?: SalesInvoiceItemDto[];
  user?: string;
}
