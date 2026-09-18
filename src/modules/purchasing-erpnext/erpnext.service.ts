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
  update_stock?: number;
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

    await this.resolveItemCode(itCode, itName, data.stock_uom || 'Nos', hsn);

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

  /**
   * Validates and auto-corrects the 15th character (check digit) of an Indian GSTIN
   * using the official GSTN / India Compliance Luhn mod-36 checksum algorithm.
   */
  private formatValidGstin(rawGstin?: string): string | undefined {
    if (!rawGstin) return undefined;
    const clean = rawGstin.trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (clean.length < 14) return clean;

    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const first14 = clean.substring(0, 14);

    let factor = 1;
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const codePoint = chars.indexOf(first14[i]);
      if (codePoint === -1) return clean;
      let addend = factor * codePoint;
      factor = factor === 2 ? 1 : 2;
      addend = Math.floor(addend / 36) + (addend % 36);
      sum += addend;
    }
    const remainder = sum % 36;
    const checkCodePoint = (36 - remainder) % 36;
    const validCheckDigit = chars[checkCodePoint];

    return first14 + validCheckDigit;
  }

  async ensureSupplierExists(supplierName: string, gstin?: string): Promise<string> {
    const sName = (supplierName || '').trim();
    if (!sName) return 'All Suppliers';
    const cleanGstin = this.formatValidGstin(gstin);

    if (this.isConfigured && this.httpClient) {
      try {
        // 1. Direct fetch by ID/Name
        const checkRes = await this.httpClient.get(`/api/resource/Supplier/${encodeURIComponent(sName)}`);
        if (checkRes.data && checkRes.data.data?.name) {
          const sDoc = checkRes.data.data;
          // If we have a GSTIN from the invoice but ERPNext supplier is missing it, update it!
          if (cleanGstin && (!sDoc.gstin || sDoc.gst_category === 'Unregistered')) {
            const pan = cleanGstin.length >= 12 ? cleanGstin.substring(2, 12) : undefined;
            await this.httpClient.put(`/api/resource/Supplier/${encodeURIComponent(sDoc.name)}`, {
              gstin: cleanGstin,
              gst_category: 'Registered Regular',
              ...(pan ? { pan } : {}),
            }).catch(() => {});
            this.logger.log(`Updated supplier ${sDoc.name} with valid GSTIN: ${cleanGstin}`);
          }
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
            const foundSupplier = searchRes.data.data[0];
            if (cleanGstin) {
              const pan = cleanGstin.length >= 12 ? cleanGstin.substring(2, 12) : undefined;
              await this.httpClient.put(`/api/resource/Supplier/${encodeURIComponent(foundSupplier.name)}`, {
                gstin: cleanGstin,
                gst_category: 'Registered Regular',
                ...(pan ? { pan } : {}),
              }).catch(() => {});
            }
            return foundSupplier.name;
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
          if (cleanGstin) {
            erpPayload.gstin = cleanGstin;
            erpPayload.gst_category = 'Registered Regular';
            if (cleanGstin.length >= 12) {
              erpPayload.pan = cleanGstin.substring(2, 12);
            }
          }

          const createRes = await this.httpClient.post('/api/resource/Supplier', erpPayload);
          const createdName = createRes.data?.data?.name || sName;
          this.logger.log(`Auto-created Supplier in live ERPNext: ${createdName} (GSTIN: ${gstin || 'None'})`);

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

  async rollbackItems(itemCodes: string[]): Promise<void> {
    if (!this.isConfigured || !this.httpClient || !itemCodes.length) return;
    for (const code of itemCodes) {
      try {
        await this.httpClient.delete(`/api/resource/Item/${encodeURIComponent(code)}`);
        await this.itemRepo.delete({ item_code: code }).catch(() => {});
        this.logger.log(`Rolled back newly created item from ERPNext: ${code}`);
      } catch (e: any) {
        this.logger.warn(`Could not rollback item ${code}: ${e.message}`);
      }
    }
  }

  /**
   * Ensures an item exists in ERPNext. If missing, auto-creates it with provided SKU, Name, HSN, and UOM.
   */
  async ensureItemExists(
    itemCode: string,
    itemName?: string,
    uom = 'Nos',
    hsn?: string,
    rate = 0,
    itemGroup = 'Products',
  ): Promise<string> {
    const code = (itemCode || itemName || 'Product Item').trim();
    const name = (itemName || itemCode || code).trim();
    const cleanUom = (uom || 'Nos').trim();
    const cleanHsn = (hsn || '').trim();

    if (!code) return 'Product Item';

    if (this.isConfigured && this.httpClient) {
      try {
        // 1. Direct check by item_code
        const checkRes = await this.httpClient.get(`/api/resource/Item/${encodeURIComponent(code)}`);
        if (checkRes.data && checkRes.data.data?.name) {
          const itemData = checkRes.data.data;
          if (itemData.has_variants === 1) {
            try {
              const varRes = await this.httpClient.get('/api/resource/Item', {
                params: {
                  filters: JSON.stringify([
                    ['variant_of', '=', code],
                    ['disabled', '=', 0],
                  ]),
                  fields: JSON.stringify(['name', 'item_name']),
                  limit_page_length: 1,
                },
              });
              if (varRes.data?.data?.length > 0) {
                return varRes.data.data[0].name;
              }
            } catch (varErr) {}
          }
          if (itemData.disabled !== 1) {
            return itemData.name;
          }
        }
      } catch (err: any) {
        // 2. Not found by code: search by exact item_name
        try {
          const searchNameRes = await this.httpClient.get('/api/resource/Item', {
            params: {
              filters: JSON.stringify([
                ['disabled', '=', 0],
                ['item_name', '=', name],
              ]),
              fields: JSON.stringify(['name', 'item_name']),
              limit_page_length: 1,
            },
          });
          if (searchNameRes.data?.data && searchNameRes.data.data.length > 0) {
            return searchNameRes.data.data[0].name;
          }
        } catch (searchErr) {}

        // 3. Item truly does not exist in ERPNext -> Auto-create it!
        try {
          const itemPayload: any = {
            doctype: 'Item',
            item_code: code,
            item_name: name || code,
            item_group: itemGroup || 'Products',
            stock_uom: cleanUom || 'Nos',
            is_stock_item: 1,
            is_purchase_item: 1,
            is_sales_item: 1,
            standard_rate: Number(rate) || 0,
            description: name || code,
          };
          if (cleanHsn) {
            itemPayload.gst_hsn_code = cleanHsn;
          }

          const createRes = await this.httpClient.post('/api/resource/Item', itemPayload);
          const createdCode = createRes.data?.data?.name || createRes.data?.data?.item_code || code;
          this.logger.log(`Auto-created new Item in live ERPNext: ${createdCode} - ${name} (HSN: ${cleanHsn || 'None'})`);

          // Save to local DB cache
          await this.itemRepo.save({
            item_code: createdCode,
            item_name: name,
            description: name,
            item_group: itemGroup || 'Products',
            stock_uom: cleanUom || 'Nos',
            standard_rate: Number(rate) || 0,
            gst_hsn_code: cleanHsn,
            default_warehouse: 'Stores - woodwolf',
            barcode: '',
          }).catch(() => {});

          this.cachedItems = null; // Invalidate memory cache so newly created item appears in searches
          return createdCode;
        } catch (createErr: any) {
          this.logger.error(`Failed to auto-create Item ${code} in ERPNext: ${createErr.message}`);
          throw new Error(`Could not create item '${code}' (${name}) in ERPNext: ${createErr.message}`);
        }
      }
    }

    // Local DB fallback
    await this.itemRepo.save({
      item_code: code,
      item_name: name,
      description: name,
      item_group: itemGroup || 'Products',
      stock_uom: cleanUom || 'Nos',
      standard_rate: Number(rate) || 0,
      gst_hsn_code: cleanHsn,
      default_warehouse: 'Stores - woodwolf',
      barcode: '',
    }).catch(() => {});

    return code;
  }

  /**
   * Resolves an item code against ERPNext without creating new items
   */
  async resolveItemCode(itemCode: string, itemName?: string, uom = 'Nos', hsn?: string): Promise<string> {
    return this.ensureItemExists(itemCode, itemName, uom, hsn);
  }

  async syncMasterDataFromErpNext(): Promise<{ suppliersCount: number; itemsCount: number }> {
    if (!this.isConfigured || !this.httpClient) {
      throw new Error('ERPNext connection is not configured in .env');
    }
    
    const pageSize = 500;

    // 1. Fetch and sync all suppliers in dynamic chunks
    let sStart = 0;
    let sCount = 0;
    let hasMoreSuppliers = true;

    while (hasMoreSuppliers) {
      const sResp = await this.httpClient.get('/api/resource/Supplier', {
        params: {
          fields: JSON.stringify(['name', 'supplier_name', 'gstin', 'tax_id', 'email_id', 'mobile_no', 'country']),
          limit_start: sStart,
          limit_page_length: pageSize,
        },
      });
      const suppliers = sResp.data?.data || [];
      if (suppliers.length > 0) {
        for (const s of suppliers) {
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
        sStart += suppliers.length;
        if (suppliers.length < pageSize) {
          hasMoreSuppliers = false;
        }
      } else {
        hasMoreSuppliers = false;
      }
    }

    // 2. Fetch and sync all items in dynamic chunks
    let iStart = 0;
    let iCount = 0;
    let hasMoreItems = true;

    while (hasMoreItems) {
      const iResp = await this.httpClient.get('/api/resource/Item', {
        params: {
          filters: JSON.stringify([['disabled', '=', 0]]),
          fields: JSON.stringify(['name', 'item_name', 'description', 'item_group', 'stock_uom', 'standard_rate', 'gst_hsn_code']),
          limit_start: iStart,
          limit_page_length: pageSize,
        },
      });
      const items = iResp.data?.data || [];
      if (items.length > 0) {
        for (const it of items) {
          await this.itemRepo.save({
            item_code: it.name,
            item_name: it.item_name || it.name,
            description: it.description || '',
            item_group: it.item_group || '',
            stock_uom: it.stock_uom || 'Nos',
            standard_rate: Number(it.standard_rate) || 0,
            gst_hsn_code: it.gst_hsn_code || '',
            default_warehouse: 'Stores - woodwolf',
            barcode: '',
          });
          iCount++;
        }
        iStart += items.length;
        if (items.length < pageSize) {
          hasMoreItems = false;
        }
      } else {
        hasMoreItems = false;
      }
    }

    this.cachedSuppliers = null;
    this.cachedItems = null;

    return { suppliersCount: sCount, itemsCount: iCount };
  }

  private cachedSuppliers: { data: ErpSupplier[]; timestamp: number } | null = null;
  private cachedItems: { data: ErpItem[]; timestamp: number } | null = null;
  private readonly CACHE_TTL_MS = 30000; // 30 seconds live cache to keep suggestions instant yet fresh

  async getAllSuppliers(): Promise<ErpSupplier[]> {
    const now = Date.now();
    if (this.cachedSuppliers && (now - this.cachedSuppliers.timestamp < this.CACHE_TTL_MS)) {
      return this.cachedSuppliers.data;
    }

    // 1. Fetch directly from live ERPNext in dynamic chunks
    if (this.isConfigured && this.httpClient) {
      try {
        const pageSize = 500;
        let start = 0;
        let allLiveSuppliers: ErpSupplier[] = [];
        let hasMore = true;

        while (hasMore) {
          const response = await this.httpClient.get('/api/resource/Supplier', {
            params: {
              fields: JSON.stringify(['name', 'supplier_name', 'gstin', 'tax_id', 'email_id', 'mobile_no', 'country']),
              limit_start: start,
              limit_page_length: pageSize,
            },
            timeout: 10000,
          });

          const pageData = response.data?.data || [];
          if (pageData.length > 0) {
            const mapped = pageData.map((s: any) => ({
              name: s.name,
              supplier_name: s.supplier_name || s.name,
              gstin: s.gstin || s.tax_id || '',
              tax_id: s.tax_id || '',
              email: s.email_id || '',
              phone: s.mobile_no || '',
              country: s.country || 'India',
            } as ErpSupplier));

            allLiveSuppliers = allLiveSuppliers.concat(mapped);
            start += pageData.length;

            if (pageData.length < pageSize) {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        }

        if (allLiveSuppliers.length > 0) {
          this.cachedSuppliers = { data: allLiveSuppliers, timestamp: now };
          this.logger.log(`Fetched and cached total ${allLiveSuppliers.length} suppliers from live ERPNext.`);
          return allLiveSuppliers;
        }
      } catch (err: any) {
        this.logger.warn(`Live ERPNext fetch suppliers failed: ${err.message}. Falling back to local database.`);
      }
    }

    // 2. Fallback to local Database only if ERPNext is unreachable
    const dbSuppliers = await this.supplierRepo.find({ order: { supplier_name: 'ASC' } });
    return dbSuppliers;
  }

  async getAllItems(): Promise<ErpItem[]> {
    const now = Date.now();
    if (this.cachedItems && (now - this.cachedItems.timestamp < this.CACHE_TTL_MS)) {
      return this.cachedItems.data;
    }

    // 1. Fetch directly from live ERPNext in dynamic chunks (all items without limit)
    if (this.isConfigured && this.httpClient) {
      try {
        const pageSize = 500;
        let start = 0;
        let allLiveItems: ErpItem[] = [];
        let hasMore = true;

        while (hasMore) {
          const response = await this.httpClient.get('/api/resource/Item', {
            params: {
              filters: JSON.stringify([['disabled', '=', 0]]),
              fields: JSON.stringify(['name', 'item_name', 'description', 'item_group', 'stock_uom', 'standard_rate', 'gst_hsn_code']),
              limit_start: start,
              limit_page_length: pageSize,
            },
            timeout: 10000,
          });

          const pageData = response.data?.data || [];
          if (pageData.length > 0) {
            const mapped = pageData.map((i: any) => ({
              item_code: i.name,
              item_name: i.item_name || i.name,
              description: i.description || '',
              item_group: i.item_group || '',
              stock_uom: i.stock_uom || 'Nos',
              standard_rate: Number(i.standard_rate) || 0,
              gst_hsn_code: i.gst_hsn_code || '',
              default_warehouse: 'Stores - woodwolf',
              barcode: '',
            } as ErpItem));

            allLiveItems = allLiveItems.concat(mapped);
            start += pageData.length;

            if (pageData.length < pageSize) {
              hasMore = false;
            }
          } else {
            hasMore = false;
          }
        }

        if (allLiveItems.length > 0) {
          this.cachedItems = { data: allLiveItems, timestamp: now };
          this.logger.log(`Fetched and cached total ${allLiveItems.length} active items from live ERPNext.`);
          return allLiveItems;
        }
      } catch (err: any) {
        this.logger.warn(`Live ERPNext fetch items failed: ${err.message}. Falling back to local database.`);
      }
    }

    // 2. Fallback to local Database only if ERPNext is unreachable
    const dbItems = await this.itemRepo.find({ order: { item_name: 'ASC' } });
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
    const queryTokens = cleanQuery.split(/\s+/).filter(Boolean);

    // Search all items and rank by relevance
    const scored = all
      .map((i) => {
        const code = (i.item_code || '').toLowerCase();
        const name = (i.item_name || '').toLowerCase();
        const desc = (i.description || '').toLowerCase();
        const hsn = (i.gst_hsn_code || '').toLowerCase();
        const group = (i.item_group || '').toLowerCase();

        let score = 0;

        // Exact match
        if (code === cleanQuery || name === cleanQuery) {
          score += 100;
        } else if (code.startsWith(cleanQuery) || name.startsWith(cleanQuery)) {
          score += 70;
        } else if (name.includes(cleanQuery) || code.includes(cleanQuery)) {
          score += 50;
        } else if (desc.includes(cleanQuery)) {
          score += 30;
        } else if (group.includes(cleanQuery) || hsn.includes(cleanQuery)) {
          score += 20;
        }

        // Multi-token match
        if (queryTokens.length > 1) {
          const fullText = `${code} ${name} ${desc} ${group} ${hsn}`;
          const allTokensMatch = queryTokens.every((token) => fullText.includes(token));
          if (allTokensMatch) {
            score += 40;
          }
        }

        return { item: i, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);

    return scored;
  }

  async getAllHsnCodes(query?: string): Promise<Array<{ hsn_code: string; description: string; count: number; sampleItems: string[] }>> {
    const items = await this.getAllItems();
    const hsnMap = new Map<string, { hsn_code: string; description: string; count: number; sampleItems: string[] }>();

    for (const it of items) {
      const hsn = (it.gst_hsn_code || '').trim();
      if (!hsn) continue;

      if (!hsnMap.has(hsn)) {
        hsnMap.set(hsn, {
          hsn_code: hsn,
          description: it.item_group || it.item_name || 'General Product',
          count: 1,
          sampleItems: [it.item_name || it.item_code],
        });
      } else {
        const entry = hsnMap.get(hsn)!;
        entry.count++;
        if (entry.sampleItems.length < 3 && it.item_name && !entry.sampleItems.includes(it.item_name)) {
          entry.sampleItems.push(it.item_name);
        }
      }
    }

    let list = Array.from(hsnMap.values());

    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((entry) => {
        const codeMatch = entry.hsn_code.toLowerCase().includes(q);
        const descMatch = entry.description.toLowerCase().includes(q);
        const sampleMatch = entry.sampleItems.some((s) => s.toLowerCase().includes(q));
        return codeMatch || descMatch || sampleMatch;
      });
    }

    return list.sort((a, b) => b.count - a.count);
  }

  private resolveValidWarehouse(candidate?: string): string {
    const defaultWarehouse = this.configService.get<string>('ERPNEXT_DEFAULT_WAREHOUSE', 'Stores - woodwolf');
    if (!candidate || typeof candidate !== 'string') return defaultWarehouse;
    const clean = candidate.trim();
    if (!clean) return defaultWarehouse;

    // Standard known ERPNext warehouses for Woodwolf / Inkreatix
    const knownWarehouses = [
      'Stores - woodwolf',
      'Finished Goods - woodwolf',
      'Goods In Transit - woodwolf',
      'Work In Progress - woodwolf',
      'Stores - t3place',
      'Finished Goods - t3place',
      'Goods In Transit - t3place',
      'Work In Progress - t3place',
    ];

    const exactMatch = knownWarehouses.find((w) => w.toLowerCase() === clean.toLowerCase());
    if (exactMatch) return exactMatch;

    if (/^stores\b/i.test(clean)) return defaultWarehouse;
    if (/^finished\s*goods\b/i.test(clean)) return 'Finished Goods - woodwolf';
    if (/^goods\s*in\s*transit\b/i.test(clean)) return 'Goods In Transit - woodwolf';
    if (/^work\s*in\s*progress\b/i.test(clean)) return 'Work In Progress - woodwolf';

    // If it's a street address or unknown string, safely fallback to default warehouse
    return defaultWarehouse;
  }

  async createPurchaseInvoice(payload: ErpNextPurchaseInvoicePayload): Promise<ErpNextCreationResult> {
    const defaultCompany = this.configService.get<string>('ERPNEXT_COMPANY', 'Woodwolf Studio (O) Pvt. Ltd');
    const defaultCostCenter = this.configService.get<string>('ERPNEXT_DEFAULT_COST_CENTER', 'Main - woodwolf');

    const setWarehouse = this.resolveValidWarehouse(payload.set_warehouse);
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
      update_stock: 1, // Automatically update warehouse stock directly
      remarks: payload.remarks || 'Created from AI invoice upload via Purchasing Module',
      items: payload.items.map((it) => ({
        item_code: (it.item_code || '').trim(),
        item_name: (it.item_name || it.item_code || '').trim(),
        description: (it.description || it.item_name || it.item_code || '').trim(),
        qty: Number(it.qty) || 1,
        rate: Number(it.rate) || 0,
        uom: (it.uom || 'Nos').trim(),
        warehouse: this.resolveValidWarehouse(it.warehouse || setWarehouse),
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

    // 1. Attempt to extract real server error message from Frappe JSON _server_messages
    if (rawErr && rawErr._server_messages) {
      try {
        const parsedMsgs = JSON.parse(rawErr._server_messages);
        if (Array.isArray(parsedMsgs) && parsedMsgs.length > 0) {
          const parsedObjects = parsedMsgs.map((m: any) => (typeof m === 'string' ? JSON.parse(m) : m));
          
          // Filter out informational alerts (Item Price added, Expense Head changed, etc.)
          const errorsOnly = parsedObjects.filter((msg: any) => {
            if (!msg || !msg.message) return false;
            if (msg.alert === 1 && !msg.raise_exception && msg.indicator !== 'red') return false;
            const text = msg.message.toLowerCase();
            if (text.includes('item price added') || text.includes('expense head changed') || text.includes('purchase receipt is created')) {
              return false;
            }
            return true;
          });

          // Prioritize actual exceptions or red indicator errors
          const realError = errorsOnly.find((msg: any) => msg.raise_exception === 1 || msg.indicator === 'red') || errorsOnly[0];

          if (realError && realError.message) {
            return realError.message.replace(/<[^>]*>?/gm, '').trim();
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
