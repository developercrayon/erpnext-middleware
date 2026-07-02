import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientService } from '../../../shared/http-client.service';
import { BaseConnector } from '../base/base-connector.abstract';
import {
  ConnectorResult,
  NormalizedInventory,
  NormalizedOrder,
  NormalizedPrice,
  NormalizedProduct,
  NormalizedShipment,
  PaginatedResult,
} from '../base/connector.types';
import { FetchOrdersParams, FetchProductsParams, UpdateResult } from '../base/connector.interface';

@Injectable()
export class ERPNextConnector extends BaseConnector {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpClientService,
  ) {
    super('ERPNextConnector');
    this.baseUrl = this.config.get<string>('erpnext.baseUrl');
    this.apiKey = this.config.get<string>('erpnext.apiKey');
    this.apiSecret = this.config.get<string>('erpnext.apiSecret');
  }

  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `token ${this.apiKey}:${this.apiSecret}`,
      'Content-Type': 'application/json',
    };
  }

  // ─── Authentication ───────────────────────────────────────────────────────

  async authenticate(): Promise<ConnectorResult<boolean>> {
    try {
      await this.http.get(`${this.baseUrl}/api/method/frappe.auth.get_logged_user`, {
        headers: this.authHeaders,
      });
      this.logger.log('ERPNext authentication successful');
      return this.success(true);
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Health Check ─────────────────────────────────────────────────────────

  async healthCheck(): Promise<ConnectorResult<{ status: string; latencyMs: number }>> {
    const { durationMs } = await this.measureTime(() =>
      this.http.get(`${this.baseUrl}/api/method/frappe.auth.get_logged_user`, {
        headers: this.authHeaders,
      }),
    );
    return this.success({ status: 'healthy', latencyMs: durationMs });
  }

  // ─── Orders (Not directly applicable for ERPNext as source) ──────────────

  async fetchOrders(
    params?: FetchOrdersParams,
  ): Promise<ConnectorResult<PaginatedResult<NormalizedOrder>>> {
    try {
      const filters = [];
      if (params?.fromDate) filters.push(['creation', '>=', params.fromDate.toISOString()]);
      if (params?.toDate) filters.push(['creation', '<=', params.toDate.toISOString()]);

      const response = await this.http.get(
        `${this.baseUrl}/api/resource/Sales Order`,
        {
          headers: this.authHeaders,
          params: {
            fields: JSON.stringify(['*']),
            filters: JSON.stringify(filters),
            limit_page_length: params?.pageSize || 50,
          },
        },
      );

      return this.success({
        items: response.data?.data || [],
        total: response.data?.data?.length || 0,
        page: 1,
        pageSize: params?.pageSize || 50,
        hasMore: false,
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Products ─────────────────────────────────────────────────────────────

  async fetchProducts(
    params?: FetchProductsParams,
  ): Promise<ConnectorResult<PaginatedResult<NormalizedProduct>>> {
    try {
      const response = await this.http.get(`${this.baseUrl}/api/resource/Item`, {
        headers: this.authHeaders,
        params: {
          fields: JSON.stringify([
            'name', 'item_name', 'item_code', 'description', 'item_group',
            'brand', 'stock_uom', 'gst_hsn_code', 'weight_per_unit', 'weight_uom',
            'has_variants', 'standard_rate', 'image', 'custom_thumbnail_image',
            'custom_amazon_price', 'custom_flipkart_price', 'custom_amazon', 'custom_flipkart', 'valuation_rate', 'custom_mrp', 'custom_amazon_product_type',
            'country_of_origin', 'custom_material', 'custom_item_type_name', 'custom_model_name', 'default_item_manufacturer', 'variant_of'
          ]),
          filters: JSON.stringify([
            ['custom_sync_marketplace', '=', 1]
          ]),
          limit_page_length: params?.pageSize || 100,
        },
      });

      const itemsData = response.data?.data || [];
      const items: NormalizedProduct[] = await Promise.all(itemsData.map(async (item: any) => {
        let images: string[] = [];
        const mainImage = item.image || item.custom_thumbnail_image;
        if (mainImage) {
          const cleanImage = mainImage.startsWith('/') ? mainImage.substring(1) : mainImage;
          const imgUrl = cleanImage.startsWith('http') ? cleanImage : `${this.baseUrl.replace(/\/$/, '')}/${cleanImage}`;
          images.push(imgUrl);
        }

        let upc = '';
        let amazonAsin = '';
        let variantAttributes: { name: string; value: string }[] = [];
        let variationTheme: string | undefined = undefined;

        try {
          const fullItemRes = await this.http.get(`${this.baseUrl}/api/resource/Item/${encodeURIComponent(item.item_code)}`, { headers: this.authHeaders });
          const fullItem = fullItemRes.data?.data;
          if (fullItem) {
            amazonAsin = fullItem.custom_amazon_asin || '';
            if (fullItem.barcodes && fullItem.barcodes.length > 0) {
              const upcBarcode = fullItem.barcodes.find((b: any) => b.barcode_type === 'UPC');
              if (upcBarcode) {
                upc = upcBarcode.barcode;
              } else {
                upc = fullItem.barcodes[0].barcode; // Fallback to first barcode
              }
            }
            if (fullItem.attributes && fullItem.attributes.length > 0) {
              variantAttributes = fullItem.attributes.map((a: any) => ({
                name: a.attribute,
                value: a.attribute_value,
              }));
              
              // Determine Variation Theme
              const hasColor = variantAttributes.some(a => a.name.toLowerCase() === 'colour' || a.name.toLowerCase() === 'color');
              const hasSize = variantAttributes.some(a => a.name.toLowerCase() === 'size');
              
              if (hasColor && hasSize) variationTheme = 'COLOR_SIZE';
              else if (hasColor) variationTheme = 'COLOR';
              else if (hasSize) variationTheme = 'SIZE';
            }
          }

          // Fetch attached images
          const fetchImagesForCode = async (code: string) => {
            const filesRes = await this.http.get(`${this.baseUrl}/api/resource/File`, {
              headers: this.authHeaders,
              params: {
                fields: JSON.stringify(['file_url']),
                filters: JSON.stringify([
                  ['attached_to_doctype', '=', 'Item'],
                  ['attached_to_name', '=', code]
                ])
              }
            });
            const files = filesRes.data?.data;
            if (files && files.length > 0) {
              for (const f of files) {
                if (f.file_url) {
                  const cleanImage = f.file_url.startsWith('/') ? f.file_url.substring(1) : f.file_url;
                  const imgUrl = cleanImage.startsWith('http') ? cleanImage : `${this.baseUrl.replace(/\/$/, '')}/${cleanImage}`;
                  if (!images.includes(imgUrl)) {
                    images.push(imgUrl);
                  }
                }
              }
            }
          };

          await fetchImagesForCode(item.item_code);

          // Image Inheritance for variants
          if (images.length === 0 && item.variant_of) {
             await fetchImagesForCode(item.variant_of);
          }

        } catch (e) {
          // Ignore individual fetch error, continue with empty upc and asin
        }

        return {
          sku: item.item_code,
          name: item.item_name,
          description: item.description,
          category: item.item_group,
          brand: item.brand,
          mrp: item.custom_mrp || 0,
          sellingPrice: item.standard_rate || 0,
          hsnCode: item.gst_hsn_code,
          weight: item.weight_per_unit,
          customAmazonPrice: item.custom_amazon_price,
          customFlipkartPrice: item.custom_flipkart_price,
          customAmazon: item.custom_amazon === 1,
          customFlipkart: item.custom_flipkart === 1,
          amazonProductType: item.custom_amazon_product_type,
          upc: upc,
          amazonAsin: amazonAsin,
          valuationRate: item.valuation_rate || 0,
          isParent: item.has_variants === 1,
          variantOf: item.variant_of || undefined,
          variationTheme,
          variantAttributes: variantAttributes.length > 0 ? variantAttributes : undefined,
          thumbnailUrl: images.length > 0 ? images[0] : undefined,
          images: images,
          rawPayload: item,
        };
      }));

      return this.success({
        items,
        total: items.length,
        page: 1,
        pageSize: params?.pageSize || 100,
        hasMore: false,
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Inventory ────────────────────────────────────────────────────────────

  async createListing(product: NormalizedProduct, isDraft: boolean): Promise<ConnectorResult<boolean>> {
    // ERPNext is the source of truth for products in this flow, we don't push listings to it
    return this.success(false);
  }

  async updateInventory(items: NormalizedInventory[]): Promise<ConnectorResult<UpdateResult>> {
    // ERPNext does not receive inventory updates from marketplaces in this flow
    return this.success({ total: 0, success: 0, failed: 0 });
  }

  async updatePrice(items: NormalizedPrice[]): Promise<ConnectorResult<UpdateResult>> {
    // ERPNext does not receive price updates from marketplaces in this flow
    return this.success({ total: 0, success: 0, failed: 0 });
  }

  async createShipment(shipment: NormalizedShipment): Promise<ConnectorResult<{ shipmentId: string }>> {
    // Not applicable for ERPNext as a source
    return this.success({ shipmentId: '' });
  }

  async cancelOrder(orderId: string, reason?: string): Promise<ConnectorResult<boolean>> {
    // Not applicable for ERPNext as a source
    return this.success(false);
  }

  // ─── ERPNext-Specific Methods ────────────────────────────────────────────

  async createSalesOrder(data: CreateSalesOrderDto): Promise<ConnectorResult<any>> {
    try {
      const response = await this.withRetry(() =>
        this.http.post(`${this.baseUrl}/api/resource/Sales Order`, data, {
          headers: this.authHeaders,
        }),
      );
      this.logger.log(`Sales Order created: ${response.data?.data?.name}`);
      return this.success(response.data?.data);
    } catch (error) {
      return this.failure(error);
    }
  }

  async getSalesOrder(orderId: string): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.get(
        `${this.baseUrl}/api/resource/Sales Order/${orderId}`,
        { headers: this.authHeaders },
      );
      return this.success(response.data?.data);
    } catch (error) {
      return this.failure(error);
    }
  }

  async cancelSalesOrder(orderId: string): Promise<ConnectorResult<boolean>> {
    try {
      await this.http.post(
        `${this.baseUrl}/api/method/frappe.client.cancel`,
        { doctype: 'Sales Order', name: orderId },
        { headers: this.authHeaders },
      );
      return this.success(true);
    } catch (error) {
      return this.failure(error);
    }
  }

  async createDeliveryNote(data: any): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.post(
        `${this.baseUrl}/api/resource/Delivery Note`,
        data,
        { headers: this.authHeaders },
      );
      return this.success(response.data?.data);
    } catch (error) {
      return this.failure(error);
    }
  }

  async createSalesInvoice(data: any): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.post(
        `${this.baseUrl}/api/resource/Sales Invoice`,
        data,
        { headers: this.authHeaders },
      );
      return this.success(response.data?.data);
    } catch (error) {
      return this.failure(error);
    }
  }

  async getItemStock(itemCode: string, warehouse?: string): Promise<ConnectorResult<any>> {
    try {
      const params: any = { item_code: itemCode };
      if (warehouse) params.warehouse = warehouse;
      const response = await this.http.get(
        `${this.baseUrl}/api/method/erpnext.stock.utils.get_stock_balance`,
        { headers: this.authHeaders, params },
      );
      return this.success(response.data?.message);
    } catch (error) {
      return this.failure(error);
    }
  }

  async getItemPrice(itemCode: string, priceList?: string): Promise<ConnectorResult<any>> {
    try {
      const priceListName =
        priceList || this.config.get<string>('erpnext.defaultPriceList');
      const response = await this.http.get(`${this.baseUrl}/api/resource/Item Price`, {
        headers: this.authHeaders,
        params: {
          filters: JSON.stringify([
            ['item_code', '=', itemCode],
            ['price_list', '=', priceListName],
          ]),
          fields: JSON.stringify(['*']),
        },
      });
      return this.success(response.data?.data?.[0]);
    } catch (error) {
      return this.failure(error);
    }
  }

  async getOrCreateCustomer(data: CreateCustomerDto): Promise<ConnectorResult<any>> {
    try {
      // Try to find existing customer by email
      if (data.email) {
        const existing = await this.http.get(`${this.baseUrl}/api/resource/Customer`, {
          headers: this.authHeaders,
          params: {
            filters: JSON.stringify([['email_id', '=', data.email]]),
            fields: JSON.stringify(['name', 'customer_name']),
          },
        });
        if (existing.data?.data?.length > 0) {
          return this.success(existing.data.data[0]);
        }
      }

      // Create new customer
      const response = await this.http.post(
        `${this.baseUrl}/api/resource/Customer`,
        {
          customer_name: data.name,
          customer_type: 'Individual',
          customer_group: 'Individual',
          email_id: data.email,
          mobile_no: data.phone,
          territory: data.territory || 'India',
        },
        { headers: this.authHeaders },
      );
      return this.success(response.data?.data);
    } catch (error) {
      return this.failure(error);
    }
  }

  async getWarehouses(): Promise<ConnectorResult<any[]>> {
    try {
      const response = await this.http.get(`${this.baseUrl}/api/resource/Warehouse`, {
        headers: this.authHeaders,
        params: {
          fields: JSON.stringify(['name', 'warehouse_name', 'is_group']),
          filters: JSON.stringify([['is_group', '=', 0]]),
        },
      });
      return this.success(response.data?.data || []);
    } catch (error) {
      return this.failure(error);
    }
  }
}

// ─── Internal DTOs ────────────────────────────────────────────────────────────

export interface CreateSalesOrderDto {
  customer: string;
  company: string;
  order_type: string;
  transaction_date: string;
  delivery_date?: string;
  items: Array<{
    item_code: string;
    qty: number;
    rate: number;
    warehouse?: string;
  }>;
  taxes?: any[];
  custom_marketplace_order_id?: string;
  custom_marketplace_source?: string;
  [key: string]: any;
}

export interface CreateCustomerDto {
  name: string;
  email?: string;
  phone?: string;
  territory?: string;
}
