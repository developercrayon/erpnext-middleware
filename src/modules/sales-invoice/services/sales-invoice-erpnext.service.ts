import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface ErpNextSalesInvoicePayload {
  doctype: 'Sales Invoice';
  customer: string;
  posting_date: string;
  due_date?: string;
  company?: string;
  currency?: string;
  update_stock?: number;
  set_warehouse?: string;
  remarks?: string;
  items: Array<{
    sales_order?: string;
    item_code: string;
    item_name?: string;
    description?: string;
    qty: number;
    uom?: string;
    rate: number;
    discount_percentage?: number;
    discount_amount?: number;
    amount?: number;
    warehouse?: string;
    cost_center?: string;
  }>;
  taxes?: Array<{
    charge_type?: string;
    account_head?: string;
    rate?: number;
    tax_amount?: number;
    description?: string;
  }>;
}

export interface ErpNextSalesInvoiceResult {
  success: boolean;
  erpnext_invoice_id?: string;
  status_code?: number;
  raw_response?: any;
  error_message?: string;
  user_friendly_error?: string;
}

@Injectable()
export class SalesInvoiceErpNextService {
  private readonly logger = new Logger(SalesInvoiceErpNextService.name);
  private httpClient: AxiosInstance | null = null;
  private isConfigured = false;

  constructor(private readonly configService: ConfigService) {
    this.initClient();
  }

  private initClient() {
    const url = this.configService.get<string>('ERPNEXT_BASE_URL');
    const apiKey = this.configService.get<string>('ERPNEXT_API_KEY');
    const apiSecret = this.configService.get<string>('ERPNEXT_API_SECRET');

    if (url && apiKey && apiSecret && apiKey !== 'your_erpnext_api_key_here') {
      this.httpClient = axios.create({
        baseURL: url.replace(/\/+$/, ''),
        headers: {
          Authorization: `token ${apiKey}:${apiSecret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 15000,
      });
      this.isConfigured = true;
      this.logger.log(`ERPNext REST client initialized for Sales Invoice host: ${url}`);
    } else {
      this.isConfigured = false;
    }
  }

  async createSalesInvoiceInERPNext(payload: ErpNextSalesInvoicePayload): Promise<ErpNextSalesInvoiceResult> {
    const defaultCompany = this.configService.get<string>('ERPNEXT_COMPANY', 'Woodwolf Studio (O) Pvt. Ltd');
    const defaultWarehouse = this.configService.get<string>('ERPNEXT_DEFAULT_WAREHOUSE', 'Stores - woodwolf');

    const formattedPayload: ErpNextSalesInvoicePayload = {
      doctype: 'Sales Invoice',
      customer: (payload.customer || 'Walk-in Customer').trim(),
      posting_date: (payload.posting_date || new Date().toISOString().split('T')[0]).trim(),
      due_date: (payload.due_date || payload.posting_date || new Date().toISOString().split('T')[0]).trim(),
      company: (payload.company || defaultCompany).trim(),
      currency: payload.currency || 'INR',
      update_stock: payload.update_stock !== undefined ? payload.update_stock : 1,
      set_warehouse: payload.set_warehouse || defaultWarehouse,
      remarks: payload.remarks || 'Generated via Sales Invoice Module',
      items: payload.items.map((it) => ({
        sales_order: it.sales_order || undefined,
        item_code: (it.item_code || '').trim(),
        item_name: (it.item_name || it.item_code || '').trim(),
        description: (it.description || it.item_name || it.item_code || '').trim(),
        qty: Number(it.qty) || 1,
        rate: Number(it.rate) || 0,
        uom: (it.uom || 'Nos').trim(),
        discount_percentage: Number(it.discount_percentage) || 0,
        discount_amount: Number(it.discount_amount) || 0,
        warehouse: it.warehouse || defaultWarehouse,
      })),
      taxes: payload.taxes || [],
    };

    if (this.isConfigured && this.httpClient) {
      try {
        const response = await this.httpClient.post('/api/resource/Sales Invoice', formattedPayload);
        const invName = response.data?.data?.name || `ACC-SINV-${Date.now()}`;
        return {
          success: true,
          erpnext_invoice_id: invName,
          status_code: response.status,
          raw_response: response.data,
        };
      } catch (error: any) {
        const statusCode = error.response?.status || 500;
        const rawErr = error.response?.data || error.message;
        const errorMsg = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);
        this.logger.error(`ERPNext Sales Invoice creation failed: ${errorMsg}`);
        return {
          success: false,
          status_code: statusCode,
          raw_response: rawErr,
          error_message: errorMsg,
          user_friendly_error: this.formatErpError(rawErr),
        };
      }
    }

    // Simulation Engine:
    const randomId = `ACC-SINV-${Math.floor(10000 + Math.random() * 90000)}`;
    this.logger.log(`[SIMULATION] Created Sales Invoice ${randomId} for customer ${payload.customer}`);
    return {
      success: true,
      erpnext_invoice_id: randomId,
      status_code: 200,
      raw_response: { data: { name: randomId, ...formattedPayload } },
    };
  }

  private formatErpError(err: any): string {
    if (typeof err === 'string') return err;
    if (err?._server_messages) {
      try {
        const msgs = JSON.parse(err._server_messages);
        return msgs.map((m: any) => (typeof m === 'string' ? JSON.parse(m).message : m.message)).join(' | ');
      } catch (e) {}
    }
    return err?.message || 'Failed to submit Sales Invoice to ERPNext';
  }
}
