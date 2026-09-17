import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import { ErpSupplier } from '../../database/entities/erp-supplier.entity';
import { ErpItem } from '../../database/entities/erp-item.entity';

export interface ErpNextPurchaseInvoicePayload {
  doctype: 'Purchase Invoice';
  supplier: string;
  posting_date: string;
  due_date?: string;
  bill_no: string;
  bill_date?: string;
  company?: string;
  currency?: string;
  conversion_rate?: number;
  set_warehouse?: string;
  cost_center?: string;
  remarks?: string;
  items: Array<{
    item_code: string;
    item_name?: string;
    description?: string;
    qty: number;
    uom?: string;
    rate: number;
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

export interface ErpNextCreationResult {
  success: boolean;
  erpnext_invoice_id?: string;
  status_code?: number;
  raw_response?: any;
  error_message?: string;
  user_friendly_error?: string;
}

@Injectable()
export class ErpNextService {
  private readonly logger = new Logger(ErpNextService.name);
  private httpClient: AxiosInstance | null = null;
  private isConfigured = false;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ErpSupplier)
    private readonly supplierRepo: Repository<ErpSupplier>,
    @InjectRepository(ErpItem)
    private readonly itemRepo: Repository<ErpItem>,
  ) {
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
      this.logger.log(`ERPNext REST client initialized for host: ${url}`);
    } else {
      this.isConfigured = false;
      this.logger.log('ERPNext credentials not fully set or placeholder used. Running with embedded Master Data & Simulation Engine.');
    }
  }

  async seedDefaultMasterDataIfEmpty(): Promise<void> {
    // Clean slate: no hardcoded static data seeded automatically.
    // Master data is dynamically fetched from ERPNext or added by user.
  }

  async addSupplier(data: Partial<ErpSupplier>): Promise<ErpSupplier> {
    const sName = (data.supplier_name || data.name || '').trim();
    if (!sName) throw new Error('Supplier name is required');

    if (this.isConfigured && this.httpClient) {
      try {
        const erpPayload = {
          doctype: 'Supplier',
          supplier_name: sName,
          supplier_group: 'All Supplier Groups',
          supplier_type: 'Company',
          gstin: data.gstin || '',
          country: data.country || 'India',
        };
        const res = await this.httpClient.post('/api/resource/Supplier', erpPayload);
        const createdName = res.data?.data?.name || sName;
        data.name = createdName;
        data.supplier_name = createdName;
        this.logger.log(`Created new Supplier in live ERPNext: ${createdName}`);
      } catch (err) {
        this.logger.warn(`Supplier creation in live ERPNext returned: ${err.message}`);
      }
    }

    const supplier = this.supplierRepo.create({
      name: data.name || sName,
      supplier_name: data.supplier_name || sName,
      gstin: data.gstin || '',
      tax_id: data.tax_id || data.gstin || '',
      email: data.email || '',
      phone: data.phone || '',
      address: data.address || '',
      state: data.state || '',
      country: data.country || 'India',
      payment_terms: data.payment_terms || 'Net 30',
    });
    return this.supplierRepo.save(supplier);
  }

  async addItem(data: Partial<ErpItem>): Promise<ErpItem> {
    const itCode = (data.item_code || data.item_name || '').trim();
    const itName = (data.item_name || data.item_code || '').trim();
    const hsn = (data.gst_hsn_code || '').trim();
    if (!itCode) throw new Error('Item code/name is required');

    await this.ensureItemExists(itCode, itName, data.stock_uom || 'Nos', hsn);

    const item = this.itemRepo.create({
      item_code: data.item_code || itCode,
      item_name: data.item_name || itName,
      description: data.description || itName,
      gst_hsn_code: hsn,
      item_group: data.item_group || 'Products',
      stock_uom: data.stock_uom || 'Nos',
      supplier_part_no: data.supplier_part_no || '',
      barcode: data.barcode || '',
      standard_rate: Number(data.standard_rate) || 0,
      default_tax_rate: Number(data.default_tax_rate) || 18,
      default_warehouse: data.default_warehouse || 'Stores - woodwolf',
    });
    return this.itemRepo.save(item);
  }

  async ensureSupplierExists(supplierName: string, gstin?: string): Promise<string> {
    const sName = (supplierName || '').trim();
    if (!sName) return 'All Suppliers';

    if (this.isConfigured && this.httpClient) {
      try {
        // 1. Direct fetch by ID/Name
        const checkRes = await this.httpClient.get(`/api/resource/Supplier/${encodeURIComponent(sName)}`);
        if (checkRes.data && checkRes.data.data?.name) {
          return checkRes.data.data.name;
        }
      } catch (err: any) {
        // 2. Search by supplier_name
        try {
          const searchRes = await this.httpClient.get('/api/resource/Supplier', {
            params: {
              filters: JSON.stringify([['supplier_name', '=', sName]]),
              limit_page_length: 1,
            },
          });
          if (searchRes.data?.data && searchRes.data.data.length > 0) {
            return searchRes.data.data[0].name;
          }
        } catch (e) {}

        // 3. Auto-create Supplier in ERPNext
        try {
          const erpPayload: any = {
            doctype: 'Supplier',
            supplier_name: sName,
            supplier_group: 'All Supplier Groups',
            supplier_type: 'Company',
            country: 'India',
          };
          if (gstin) erpPayload.gstin = gstin;

          const createRes = await this.httpClient.post('/api/resource/Supplier', erpPayload);
          const createdName = createRes.data?.data?.name || sName;
          this.logger.log(`Auto-created Supplier in live ERPNext: ${createdName}`);

          // Also save in local SQLite master database
          await this.supplierRepo.save({
            name: createdName,
            supplier_name: sName,
            gstin: gstin || '',
            country: 'India',
          }).catch(() => {});

          return createdName;
        } catch (createErr: any) {
          // Fallback with 'Local' or default group if 'All Supplier Groups' fails
          try {
            const createRes = await this.httpClient.post('/api/resource/Supplier', {
              doctype: 'Supplier',
              supplier_name: sName,
              supplier_group: 'Local',
              supplier_type: 'Company',
              country: 'India',
            });
            const createdName = createRes.data?.data?.name || sName;
            this.logger.log(`Auto-created Supplier with Local group: ${createdName}`);
            return createdName;
          } catch (createErr2: any) {
            this.logger.warn(`Could not auto-create supplier ${sName} in ERPNext: ${createErr.message}`);
          }
        }
      }
    }

    // Save in local DB if not already present
    await this.supplierRepo.save({
      name: sName,
      supplier_name: sName,
      gstin: gstin || '',
      country: 'India',
    }).catch(() => {});

    return sName;
  }

  async ensureItemExists(itemCode: string, itemName?: string, uom = 'Nos', hsn?: string): Promise<string> {
    const code = (itemCode || itemName || 'Product Item').trim();
    const name = (itemName || itemCode || code).trim();
    if (!code) return 'Product Item';

    if (this.isConfigured && this.httpClient) {
      try {
        const checkRes = await this.httpClient.get(`/api/resource/Item/${encodeURIComponent(code)}`);
        if (checkRes.data && checkRes.data.data?.name) {
          return checkRes.data.data.name;
        }
      } catch (err: any) {
        // Try creating the item in live ERPNext
        try {
          const erpPayload: any = {
            doctype: 'Item',
            item_code: code,
            item_name: name,
            item_group: 'All Item Groups',
            stock_uom: uom || 'Nos',
            is_stock_item: 1,
          };
          if (hsn) erpPayload.gst_hsn_code = hsn;

          const createRes = await this.httpClient.post('/api/resource/Item', erpPayload);
          const createdCode = createRes.data?.data?.name || code;
          this.logger.log(`Auto-created Item in live ERPNext: ${createdCode}`);

          await this.itemRepo.save({
            item_code: createdCode,
            item_name: name,
            stock_uom: uom || 'Nos',
          }).catch(() => {});

          return createdCode;
        } catch (createErr: any) {
          // Fallback to 'Products' group
          try {
            const createRes = await this.httpClient.post('/api/resource/Item', {
              doctype: 'Item',
              item_code: code,
              item_name: name,
              item_group: 'Products',
              stock_uom: uom || 'Nos',
              is_stock_item: 1,
            });
            const createdCode = createRes.data?.data?.name || code;
            return createdCode;
          } catch (createErr2: any) {
            this.logger.warn(`Could not auto-create item ${code} in ERPNext: ${createErr.message}`);
          }
        }
      }
    }

    return code;
  }

  async syncMasterDataFromErpNext(): Promise<{ suppliersCount: number; itemsCount: number }> {
    if (!this.isConfigured || !this.httpClient) {
      throw new Error('ERPNext connection is not configured in .env');
    }
    
    // Fetch and sync suppliers
    const sResp = await this.httpClient.get('/api/resource/Supplier', {
      params: {
        fields: JSON.stringify(['name', 'supplier_name', 'gstin', 'tax_id', 'email_id', 'mobile_no', 'country']),
        limit_page_length: 500,
      },
    });
    let sCount = 0;
    if (sResp.data && sResp.data.data) {
      for (const s of sResp.data.data) {
        await this.supplierRepo.save({
          name: s.name,
          supplier_name: s.supplier_name || s.name,
          gstin: s.gstin || s.tax_id || '',
          tax_id: s.tax_id || '',
          email: s.email_id || '',
          phone: s.mobile_no || '',
          country: s.country || 'India',
        });
        sCount++;
      }
    }

    // Fetch and sync items
    const iResp = await this.httpClient.get('/api/resource/Item', {
      params: {
        fields: JSON.stringify(['name', 'item_name', 'description', 'item_group', 'stock_uom']),
        limit_page_length: 500,
      },
    });
    let iCount = 0;
    if (iResp.data && iResp.data.data) {
      for (const it of iResp.data.data) {
        await this.itemRepo.save({
          item_code: it.name,
          item_name: it.item_name || it.name,
          description: it.description || '',
          item_group: it.item_group || '',
          stock_uom: it.stock_uom || 'Nos',
          standard_rate: 0,
          default_warehouse: 'Stores - WSPL',
          barcode: '',
        });
        iCount++;
      }
    }

    this.cachedSuppliers = null;
    this.cachedItems = null;

    return { suppliersCount: sCount, itemsCount: iCount };
  }

  private cachedSuppliers: { data: ErpSupplier[]; timestamp: number } | null = null;
  private cachedItems: { data: ErpItem[]; timestamp: number } | null = null;
  private readonly CACHE_TTL_MS = 120000; // 2 minutes

  async getAllSuppliers(): Promise<ErpSupplier[]> {
    const now = Date.now();
    if (this.cachedSuppliers && (now - this.cachedSuppliers.timestamp < this.CACHE_TTL_MS)) {
      return this.cachedSuppliers.data;
    }

    // 1. Fast Database lookup first (< 5ms)
    const dbSuppliers = await this.supplierRepo.find({ order: { supplier_name: 'ASC' } });
    if (dbSuppliers && dbSuppliers.length > 0) {
      this.cachedSuppliers = { data: dbSuppliers, timestamp: now };
      return dbSuppliers;
    }

    // 2. Fetch from live ERPNext if DB is empty
    if (this.isConfigured && this.httpClient) {
      try {
        const response = await this.httpClient.get('/api/resource/Supplier', {
          params: {
            fields: JSON.stringify(['name', 'supplier_name', 'gstin', 'tax_id', 'email_id', 'mobile_no', 'country']),
            limit_page_length: 500,
          },
          timeout: 4000,
        });
        if (response.data && response.data.data) {
          const liveSuppliers = response.data.data.map((s: any) => ({
            name: s.name,
            supplier_name: s.supplier_name || s.name,
            gstin: s.gstin || s.tax_id || '',
            tax_id: s.tax_id || '',
            email: s.email_id || '',
            phone: s.mobile_no || '',
            country: s.country || 'India',
          } as ErpSupplier));

          for (const sup of liveSuppliers) {
            await this.supplierRepo.save({
              name: sup.name,
              supplier_name: sup.supplier_name,
              gstin: sup.gstin,
              tax_id: sup.tax_id,
              email: sup.email,
              phone: sup.phone,
              country: sup.country,
            }).catch(() => {});
          }

          this.cachedSuppliers = { data: liveSuppliers, timestamp: now };
          return liveSuppliers;
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch suppliers from live ERPNext: ${err.message}.`);
      }
    }
    return dbSuppliers;
  }

  async getAllItems(): Promise<ErpItem[]> {
    const now = Date.now();
    if (this.cachedItems && (now - this.cachedItems.timestamp < this.CACHE_TTL_MS)) {
      return this.cachedItems.data;
    }

    // 1. Fast Database lookup first (< 5ms)
    const dbItems = await this.itemRepo.find({ order: { item_name: 'ASC' } });
    if (dbItems && dbItems.length > 0) {
      this.cachedItems = { data: dbItems, timestamp: now };
      return dbItems;
    }

    // 2. Fetch from live ERPNext if DB is empty
    if (this.isConfigured && this.httpClient) {
      try {
        const response = await this.httpClient.get('/api/resource/Item', {
          params: {
            fields: JSON.stringify(['name', 'item_name', 'description', 'item_group', 'stock_uom']),
            limit_page_length: 500,
          },
          timeout: 4000,
        });
        if (response.data && response.data.data) {
          const liveItems = response.data.data.map((i: any) => ({
            item_code: i.name,
            item_name: i.item_name || i.name,
            description: i.description || '',
            item_group: i.item_group || '',
            stock_uom: i.stock_uom || 'Nos',
            standard_rate: 0,
            default_warehouse: 'Stores - woodwolf',
            barcode: '',
          } as ErpItem));

          for (const it of liveItems) {
            await this.itemRepo.save({
              item_code: it.item_code,
              item_name: it.item_name,
              description: it.description,
              item_group: it.item_group,
              stock_uom: it.stock_uom,
            }).catch(() => {});
          }

          this.cachedItems = { data: liveItems, timestamp: now };
          return liveItems;
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch items from live ERPNext: ${err.message}.`);
      }
    }
    return dbItems;
  }

  async searchSupplierByNameOrGstin(query: string): Promise<ErpSupplier[]> {
    const cleanQuery = (query || '').trim().toLowerCase();
    if (!cleanQuery) return [];

    const all = await this.getAllSuppliers();
    return all.filter((s) => {
      const nameMatch = (s.supplier_name || s.name || '').toLowerCase().includes(cleanQuery);
      const gstinMatch = s.gstin && s.gstin.toLowerCase().includes(cleanQuery);
      return nameMatch || gstinMatch;
    });
  }

  async searchItems(query: string): Promise<ErpItem[]> {
    const cleanQuery = (query || '').trim().toLowerCase();
    if (!cleanQuery) return [];

    const all = await this.getAllItems();
    return all.filter((i) => {
      const codeMatch = (i.item_code || '').toLowerCase().includes(cleanQuery);
      const nameMatch = (i.item_name || '').toLowerCase().includes(cleanQuery);
      const descMatch = (i.description || '').toLowerCase().includes(cleanQuery);
      return codeMatch || nameMatch || descMatch;
    });
  }

  async createPurchaseInvoice(payload: ErpNextPurchaseInvoicePayload): Promise<ErpNextCreationResult> {
    const defaultCompany = this.configService.get<string>('ERPNEXT_COMPANY', 'Woodwolf Studio (O) Pvt. Ltd');
    const defaultWarehouse = this.configService.get<string>('ERPNEXT_DEFAULT_WAREHOUSE', 'Stores - woodwolf');
    const defaultCostCenter = this.configService.get<string>('ERPNEXT_DEFAULT_COST_CENTER', 'Main - woodwolf');

    const setWarehouse = (payload.set_warehouse || defaultWarehouse).trim();
    const costCenter = (payload.cost_center || defaultCostCenter).trim();

    const formattedPayload: ErpNextPurchaseInvoicePayload = {
      doctype: 'Purchase Invoice',
      supplier: (payload.supplier || '').trim(),
      posting_date: (payload.posting_date || '').trim(),
      due_date: (payload.due_date || payload.posting_date || '').trim(),
      bill_no: (payload.bill_no || '').trim(),
      bill_date: (payload.bill_date || payload.posting_date || '').trim(),
      company: (payload.company || defaultCompany).trim(),
      currency: payload.currency || 'INR',
      set_warehouse: setWarehouse,
      cost_center: costCenter,
      remarks: payload.remarks || 'Created from AI invoice upload via Purchasing Module',
      items: payload.items.map((it) => ({
        item_code: (it.item_code || '').trim(),
        item_name: (it.item_name || it.item_code || '').trim(),
        description: (it.description || it.item_name || it.item_code || '').trim(),
        qty: Number(it.qty) || 1,
        rate: Number(it.rate) || 0,
        uom: (it.uom || 'Nos').trim(),
        warehouse: (it.warehouse || setWarehouse).trim(),
        cost_center: (it.cost_center || costCenter).trim(),
      })),
      taxes: payload.taxes || [],
    };

    if (this.isConfigured && this.httpClient) {
      try {
        const response = await this.httpClient.post('/api/resource/Purchase Invoice', formattedPayload);
        const invName = response.data?.data?.name || `PINV-${Date.now()}`;
        return {
          success: true,
          erpnext_invoice_id: invName,
          status_code: response.status,
          raw_response: response.data,
        };
      } catch (error: any) {
        const statusCode = error.response?.status || 500;
        const rawErr = error.response?.data || error.message;
        const userFriendly = this.translateErpError(rawErr, formattedPayload);

        this.logger.error(`ERPNext Invoice creation failed: ${JSON.stringify(rawErr)}`);
        return {
          success: false,
          status_code: statusCode,
          raw_response: rawErr,
          error_message: typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr),
          user_friendly_error: userFriendly,
        };
      }
    }

    // Simulation / Local Sandbox Mode:
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    const mockInvoiceId = `PINV-${randomNum}`;
    this.logger.log(`[SIMULATION] Created Purchase Invoice ${mockInvoiceId} in ERPNext local engine for supplier ${payload.supplier}`);

    return {
      success: true,
      erpnext_invoice_id: mockInvoiceId,
      status_code: 200,
      raw_response: {
        data: {
          name: mockInvoiceId,
          docstatus: 1,
          ...formattedPayload,
        },
      },
    };
  }

  private translateErpError(rawErr: any, payload: ErpNextPurchaseInvoicePayload): string {
    const errorStr = (typeof rawErr === 'object' ? JSON.stringify(rawErr) : String(rawErr));

    // 1. Attempt to extract server message from Frappe JSON _server_messages
    if (rawErr && rawErr._server_messages) {
      try {
        const parsedMsgs = JSON.parse(rawErr._server_messages);
        if (Array.isArray(parsedMsgs) && parsedMsgs.length > 0) {
          const first = JSON.parse(parsedMsgs[0]);
          if (first && first.message) {
            return first.message.replace(/<[^>]*>?/gm, '').trim();
          }
        }
      } catch (e) {}
    }

    // 2. Extract ValidationError or throw from traceback / html
    const valErrMatch = errorStr.match(/(?:frappe\.exceptions\.)?ValidationError:\s*([^\n\r<"\\]+)/i) ||
                        errorStr.match(/throw\(_\(['"]([^'"]+)['"]\)/i) ||
                        errorStr.match(/<textarea[^>]*>[\s\S]*?ValidationError:\s*([^\n\r<]+)/i);
    if (valErrMatch && valErrMatch[1]) {
      return valErrMatch[1].trim();
    }

    if (rawErr?.exception) {
      return String(rawErr.exception).replace(/<[^>]*>?/gm, '').trim();
    }

    if (errorStr.toLowerCase().includes('duplicate') || errorStr.toLowerCase().includes('already exists')) {
      return `A Purchase Invoice with Bill No "${payload.bill_no}" for supplier "${payload.supplier}" already exists in ERPNext.`;
    }

    if (errorStr.toLowerCase().includes('does not exist') || errorStr.toLowerCase().includes('not found')) {
      return `Item or Supplier was not found in ERPNext. Please verify exact item codes in ERPNext.`;
    }

    return typeof rawErr === 'object' && rawErr.message ? rawErr.message : 'ERPNext could not process this invoice transaction. Please check ERP item codes and supplier.';
  }

  getStatus(): { configured: boolean; erpUrl: string; company: string; warehouse: string } {
    return {
      configured: this.isConfigured,
      erpUrl: this.configService.get<string>('ERPNEXT_BASE_URL', 'https://woodwolf.t3elements.com'),
      company: this.configService.get<string>('ERPNEXT_COMPANY', 'Woodwolf Studio (O) Pvt. Ltd'),
      warehouse: this.configService.get<string>('ERPNEXT_DEFAULT_WAREHOUSE', 'Stores - woodwolf'),
    };
  }
}
