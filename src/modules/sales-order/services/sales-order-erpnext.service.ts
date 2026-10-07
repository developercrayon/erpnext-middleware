import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import { ErpCustomer } from '../../../database/entities/erp-customer.entity';
import { ErpItem } from '../../../database/entities/erp-item.entity';

export interface ErpNextSalesOrderPayload {
  doctype: 'Sales Order';
  customer: string;
  transaction_date: string;
  delivery_date: string;
  customer_address?: string;
  shipping_address_name?: string;
  address_display?: string;
  shipping_address_display?: string;
  billing_address?: string;
  shipping_address?: string;
  company?: string;
  currency?: string;
  order_type?: string;
  set_warehouse?: string;
  po_no?: string;
  po_date?: string;
  remarks?: string;
  items: Array<{
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
    delivery_date?: string;
  }>;
  taxes?: Array<{
    charge_type?: string;
    account_head?: string;
    rate?: number;
    tax_amount?: number;
    description?: string;
  }>;
}

export interface ErpNextSalesOrderResult {
  success: boolean;
  erpnext_so_id?: string;
  status_code?: number;
  raw_response?: any;
  error_message?: string;
  user_friendly_error?: string;
}

@Injectable()
export class SalesOrderErpNextService {
  private readonly logger = new Logger(SalesOrderErpNextService.name);
  private httpClient: AxiosInstance | null = null;
  private isConfigured = false;
  private cachedCustomers: { data: ErpCustomer[]; timestamp: number } | null = null;
  private readonly CACHE_TTL_MS = 30000;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ErpCustomer)
    private readonly customerRepo: Repository<ErpCustomer>,
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
      this.logger.log(`ERPNext REST client initialized for Sales module host: ${url}`);
    } else {
      this.isConfigured = false;
      this.logger.log('ERPNext credentials not configured. Running Sales Order with simulation engine.');
    }
  }

  /**
   * Ensures a Customer exists in ERPNext before creating a Sales Order.
   * If customer is missing, auto-creates in ERPNext and saves locally.
   */
  async ensureCustomerExists(
    customerName: string,
    email?: string,
    phone?: string,
    gstin?: string,
    customerGroup?: string,
  ): Promise<string> {
    const cleanName = (customerName || '').trim();
    if (!cleanName) return 'Walk-in Customer';

    const targetGroup = customerGroup && customerGroup !== 'All Customer Groups' 
      ? customerGroup 
      : (gstin ? 'Commercial' : 'Individual');
    const targetType = gstin ? 'Company' : 'Individual';

    // 1. Check local DB
    const existing = await this.customerRepo.findOne({
      where: [{ name: cleanName }, { customer_name: cleanName }],
    });
    if (existing) return existing.name;

    // 2. Check live ERPNext
    if (this.isConfigured && this.httpClient) {
      try {
        const checkRes = await this.httpClient.get(`/api/resource/Customer/${encodeURIComponent(cleanName)}`);
        if (checkRes.data?.data?.name) {
          const cData = checkRes.data.data;
          await this.customerRepo.save({
            name: cData.name,
            customer_name: cData.customer_name || cData.name,
            customer_group: cData.customer_group || targetGroup,
            customer_type: cData.customer_type || targetType,
            gstin: cData.gstin || gstin || '',
            email: cData.email_id || email || '',
            phone: cData.mobile_no || phone || '',
          });
          return cData.name;
        }
      } catch (err) {
        // Not found by direct ID, search by customer_name
        try {
          const searchRes = await this.httpClient.get('/api/resource/Customer', {
            params: {
              filters: JSON.stringify([['customer_name', '=', cleanName]]),
              fields: JSON.stringify(['name', 'customer_name', 'customer_group', 'customer_type']),
              limit_page_length: 1,
            },
          });
          if (searchRes.data?.data?.length > 0) {
            const found = searchRes.data.data[0];
            await this.customerRepo.save({
              name: found.name,
              customer_name: found.customer_name || cleanName,
              customer_group: found.customer_group || targetGroup,
              customer_type: found.customer_type || targetType,
              gstin: gstin || '',
              email: email || '',
              phone: phone || '',
            });
            return found.name;
          }
        } catch (searchErr) {}

        // Customer truly does not exist in live ERPNext -> Auto-create!
        try {
          const payload: any = {
            doctype: 'Customer',
            customer_name: cleanName,
            customer_group: targetGroup,
            customer_type: targetType,
            territory: 'India',
          };
          if (gstin) payload.gstin = gstin;
          if (email) payload.email_id = email;
          if (phone) payload.mobile_no = phone;

          const createRes = await this.httpClient.post('/api/resource/Customer', payload);
          const createdName = createRes.data?.data?.name || cleanName;
          this.logger.log(`Auto-created new Customer in live ERPNext: ${createdName} (group: ${targetGroup})`);

          await this.customerRepo.save({
            name: createdName,
            customer_name: cleanName,
            customer_group: targetGroup,
            customer_type: targetType,
            gstin: gstin || '',
            email: email || '',
            phone: phone || '',
          });
          return createdName;
        } catch (createErr: any) {
          const errMsg = createErr.response?.data?._server_messages || createErr.response?.data?.exception || createErr.message;
          this.logger.warn(`Could not auto-create customer in ERPNext with group ${targetGroup}: ${errMsg}`);
          // Fallback attempt with 'Individual' group
          if (targetGroup !== 'Individual') {
            try {
              const fallbackPayload: any = {
                doctype: 'Customer',
                customer_name: cleanName,
                customer_group: 'Individual',
                customer_type: 'Individual',
                territory: 'India',
              };
              if (email) fallbackPayload.email_id = email;
              if (phone) fallbackPayload.mobile_no = phone;
              const res2 = await this.httpClient.post('/api/resource/Customer', fallbackPayload);
              const name2 = res2.data?.data?.name || cleanName;
              this.logger.log(`Auto-created Customer with fallback Individual group: ${name2}`);
              await this.customerRepo.save({
                name: name2,
                customer_name: cleanName,
                customer_group: 'Individual',
                customer_type: 'Individual',
                gstin: gstin || '',
                email: email || '',
                phone: phone || '',
              });
              return name2;
            } catch (err2: any) {
              this.logger.error(`Fallback customer creation failed: ${err2.message}`);
            }
          }
        }
      }
    }

    // Fallback: save to local repository
    const local = this.customerRepo.create({
      name: cleanName,
      customer_name: cleanName,
      customer_group: targetGroup,
      customer_type: targetType,
      gstin: gstin || '',
      email: email || '',
      phone: phone || '',
    });
    await this.customerRepo.save(local);
    return cleanName;
  }

  /**
   * Strictly validates that an Item exists in ERPNext before creating a Sales Order.
   * If missing, rejects and throws error (never auto-creates items).
   */
  async ensureItemExists(
    itemCode: string,
    itemName?: string,
    uom = 'Nos',
    hsn?: string,
    rate = 0,
    itemGroup = 'Products',
  ): Promise<string> {
    const code = (itemCode || itemName || '').trim();
    const name = (itemName || itemCode || '').trim();
    const cleanUom = (uom || 'Nos').trim();
    const rawHsn = (hsn || '').replace(/[^0-9]/g, '');
    const cleanHsn = rawHsn.length >= 6 ? rawHsn : '44201000';

    if (!code && !name) {
      throw new Error('Item Code or Item Name is required for ERP validation.');
    }

    // 1. Check live ERPNext
    if (this.isConfigured && this.httpClient) {
      // 1a. Check by exact item_code
      if (code) {
        try {
          const checkRes = await this.httpClient.get(`/api/resource/Item/${encodeURIComponent(code)}`);
          if (checkRes.data?.data?.name && !checkRes.data.data.disabled) {
            const itemData = checkRes.data.data;
            await this.itemRepo.save({
              item_code: itemData.name,
              item_name: itemData.item_name || itemData.name,
              gst_hsn_code: itemData.gst_hsn_code || cleanHsn,
              stock_uom: itemData.stock_uom || cleanUom,
              item_group: itemData.item_group || itemGroup,
              standard_rate: Number(itemData.standard_rate) || rate,
            }).catch(() => {});
            return itemData.name;
          }
        } catch (err) {
          // Continue to search by item_name
        }
      }

      // 1b. Check by item_name
      if (name) {
        try {
          const searchNameRes = await this.httpClient.get('/api/resource/Item', {
            params: {
              filters: JSON.stringify([
                ['disabled', '=', 0],
                ['item_name', '=', name],
              ]),
              fields: JSON.stringify(['name', 'item_name', 'stock_uom', 'gst_hsn_code']),
              limit_page_length: 1,
            },
          });
          if (searchNameRes.data?.data && searchNameRes.data.data.length > 0) {
            const found = searchNameRes.data.data[0];
            await this.itemRepo.save({
              item_code: found.name,
              item_name: found.item_name || name,
              gst_hsn_code: found.gst_hsn_code || cleanHsn,
              stock_uom: found.stock_uom || cleanUom,
              item_group: itemGroup,
              standard_rate: rate,
            }).catch(() => {});
            return found.name;
          }
        } catch (searchErr) {}
      }

      // Item does NOT exist in live ERPNext -> STRICTLY REJECT
      this.logger.error(`Item validation failed: Item "${code}" (${name}) is NOT registered in live ERPNext.`);
      throw new Error(`Item "${code || name}" does not exist in ERPNext master catalog. Please select a valid ERP Item.`);
    }

    // 2. Offline / local fallback (only when ERPNext credentials are not configured)
    const localItem = await this.itemRepo.findOne({
      where: [{ item_code: code }, { item_name: name }],
    });
    if (localItem) return localItem.item_code;

    throw new Error(`Item "${code || name}" does not exist in local catalog.`);
  }

  /**
   * Ensures an Address is linked to Customer in ERPNext
   */
  async ensureCustomerAddressExists(
    customerName: string,
    addressText: string,
    addressType: 'Billing' | 'Shipping' = 'Billing',
  ): Promise<string | null> {
    const cleanAddr = (addressText || '').trim();
    if (!cleanAddr) return null;
    if (!this.isConfigured || !this.httpClient) return null;

    try {
      // 1. Check existing address linked to this customer
      const checkRes = await this.httpClient.get('/api/resource/Address', {
        params: {
          filters: JSON.stringify([
            ['Dynamic Link', 'link_doctype', '=', 'Customer'],
            ['Dynamic Link', 'link_name', '=', customerName],
            ['address_type', '=', addressType],
          ]),
          fields: JSON.stringify(['name', 'address_title', 'address_line1']),
          limit_page_length: 1,
        },
      });

      if (checkRes.data?.data && checkRes.data.data.length > 0) {
        return checkRes.data.data[0].name;
      }

      // 2. Create Address in ERPNext
      const pinMatch = cleanAddr.match(/\b([1-9][0-9]{5})\b/);
      const pincode = pinMatch ? pinMatch[1] : '';

      const addrPayload = {
        doctype: 'Address',
        address_title: customerName,
        address_type: addressType,
        address_line1: cleanAddr.slice(0, 140),
        address_line2: cleanAddr.length > 140 ? cleanAddr.slice(140, 280) : undefined,
        city: 'Rajkot',
        state: 'Gujarat',
        country: 'India',
        pincode: pincode || undefined,
        links: [
          {
            doctype: 'Dynamic Link',
            link_doctype: 'Customer',
            link_name: customerName,
          },
        ],
      };

      const createRes = await this.httpClient.post('/api/resource/Address', addrPayload);
      const addrName = createRes.data?.data?.name || null;
      if (addrName) {
        this.logger.log(`Created ${addressType} Address ${addrName} for customer ${customerName}`);
      }
      return addrName;
    } catch (err: any) {
      this.logger.warn(`Could not link ${addressType} address for customer ${customerName} in ERP: ${err.message}`);
      return null;
    }
  }

  async getAllCustomers(): Promise<ErpCustomer[]> {
    const now = Date.now();
    if (this.cachedCustomers && now - this.cachedCustomers.timestamp < this.CACHE_TTL_MS) {
      return this.cachedCustomers.data;
    }

    if (this.isConfigured && this.httpClient) {
      try {
        const pageSize = 500;
        let start = 0;
        let allCustomers: ErpCustomer[] = [];
        let hasMore = true;

        while (hasMore) {
          const response = await this.httpClient.get('/api/resource/Customer', {
            params: {
              fields: JSON.stringify(['name', 'customer_name', 'customer_group', 'customer_type', 'gstin', 'email_id', 'mobile_no']),
              limit_start: start,
              limit_page_length: pageSize,
            },
            timeout: 10000,
          });

          const pageData = response.data?.data || [];
          if (pageData.length > 0) {
            const mapped = pageData.map((c: any) => ({
              name: c.name,
              customer_name: c.customer_name || c.name,
              customer_group: c.customer_group || 'All Customer Groups',
              customer_type: c.customer_type || 'Company',
              gstin: c.gstin || '',
              email: c.email_id || '',
              phone: c.mobile_no || '',
              country: 'India',
            } as ErpCustomer));

            allCustomers = allCustomers.concat(mapped);
            start += pageData.length;
            if (pageData.length < pageSize) hasMore = false;
          } else {
            hasMore = false;
          }
        }

        if (allCustomers.length > 0) {
          this.cachedCustomers = { data: allCustomers, timestamp: now };
          return allCustomers;
        }
      } catch (err: any) {
        this.logger.warn(`Live ERPNext fetch customers failed: ${err.message}. Falling back to local DB.`);
      }
    }

    return this.customerRepo.find({ order: { customer_name: 'ASC' } });
  }

  async searchCustomersByNameOrGstin(query: string): Promise<ErpCustomer[]> {
    const all = await this.getAllCustomers();
    if (!query || !query.trim()) return all;
    const q = query.toLowerCase().trim();

    return all.filter((c) =>
      c.customer_name?.toLowerCase().includes(q) ||
      c.name?.toLowerCase().includes(q) ||
      c.gstin?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.phone?.toLowerCase().includes(q)
    );
  }

  async addCustomer(data: Partial<ErpCustomer>): Promise<ErpCustomer> {
    const cName = (data.customer_name || data.name || '').trim();
    if (!cName) throw new Error('Customer name is required');

    const verifiedName = await this.ensureCustomerExists(cName, data.email, data.phone, data.gstin);
    let customer = await this.customerRepo.findOne({ where: { name: verifiedName } });
    if (!customer) {
      customer = this.customerRepo.create({
        name: verifiedName,
        customer_name: cName,
        customer_group: data.customer_group || 'All Customer Groups',
        customer_type: data.customer_type || 'Company',
        gstin: data.gstin || '',
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || '',
        city: data.city || '',
        state: data.state || '',
      });
      customer = await this.customerRepo.save(customer);
    }
    return customer;
  }

  /**
   * Posts formatted Sales Order to ERPNext API
   */
  async createSalesOrderInERPNext(payload: ErpNextSalesOrderPayload): Promise<ErpNextSalesOrderResult> {
    const defaultCompany = this.configService.get<string>('ERPNEXT_COMPANY', 'Woodwolf Studio (O) Pvt. Ltd');
    const defaultWarehouse = this.configService.get<string>('ERPNEXT_DEFAULT_WAREHOUSE', 'Stores - woodwolf');

    const formattedPayload: any = {
      doctype: 'Sales Order',
      customer: (payload.customer || 'Walk-in Customer').trim(),
      transaction_date: (payload.transaction_date || new Date().toISOString().split('T')[0]).trim(),
      delivery_date: (payload.delivery_date || payload.transaction_date || new Date().toISOString().split('T')[0]).trim(),
      company: (payload.company || defaultCompany).trim(),
      currency: payload.currency || 'INR',
      order_type: payload.order_type || 'Sales',
      set_warehouse: payload.set_warehouse || defaultWarehouse,
      po_no: payload.po_no || undefined,
      po_date: payload.po_date || undefined,
      customer_address: payload.customer_address || undefined,
      shipping_address_name: payload.shipping_address_name || payload.customer_address || undefined,
      address_display: payload.address_display || payload.billing_address || undefined,
      shipping_address_display: payload.shipping_address_display || payload.shipping_address || payload.billing_address || undefined,
      remarks: payload.remarks || 'Created via Sales Order Module',
      items: payload.items.map((it) => ({
        item_code: (it.item_code || '').trim(),
        item_name: (it.item_name || it.item_code || '').trim(),
        description: (it.description || it.item_name || it.item_code || '').trim(),
        qty: Number(it.qty) || 1,
        rate: Number(it.rate) || 0,
        uom: (it.uom || 'Nos').trim(),
        discount_percentage: Number(it.discount_percentage) || 0,
        discount_amount: Number(it.discount_amount) || 0,
        warehouse: it.warehouse || defaultWarehouse,
        delivery_date: it.delivery_date || payload.delivery_date || payload.transaction_date,
      })),
      taxes: payload.taxes || [],
    };

    if (this.isConfigured && this.httpClient) {
      try {
        const response = await this.httpClient.post('/api/resource/Sales Order', formattedPayload);
        const soName = response.data?.data?.name || `SO-${Date.now()}`;
        return {
          success: true,
          erpnext_so_id: soName,
          status_code: response.status,
          raw_response: response.data,
        };
      } catch (error: any) {
        const statusCode = error.response?.status || 500;
        const rawErr = error.response?.data || error.message;
        const errorMsg = typeof rawErr === 'string' ? rawErr : JSON.stringify(rawErr);
        this.logger.error(`ERPNext Sales Order creation failed: ${errorMsg}`);
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
    const randomId = `SO-${Math.floor(10000 + Math.random() * 90000)}`;
    this.logger.log(`[SIMULATION] Created Sales Order ${randomId} for customer ${payload.customer}`);
    return {
      success: true,
      erpnext_so_id: randomId,
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
    if (err?.exc_type) return `ERPNext Exception (${err.exc_type}): ${err.exception || 'Check fields'}`;
    return err?.message || 'Failed to submit Sales Order to ERPNext';
  }
}
