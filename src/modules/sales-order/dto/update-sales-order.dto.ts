import { SalesOrderItemDto } from './create-sales-order.dto';

export class UpdateSalesOrderDto {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  customer_gstin?: string;
  billing_address?: string;
  shipping_address?: string;
  order_date?: string;
  delivery_date?: string;
  po_no?: string;
  currency?: string;
  status?: string;
  items?: SalesOrderItemDto[];
  user?: string;
}
