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
      // Trim trailing slash to avoid double-slash in URL construction
      const baseUrl = this.baseUrl.replace(/\/$/, '');

      const filters: any[] = [
        ['custom_sync_marketplace', '=', 1],
      ];
      if (params?.sku) {
        filters.push(['item_code', '=', params.sku]);
      }

      // ── Step 1: Fetch item list with ONLY guaranteed standard fields ──────
      // Using custom fields in the list query causes ERPNext DataError (HTTP 500)
      // if the field doesn't exist. All custom fields are read per-item below.
      let listResponse: any;
      try {
        listResponse = await this.http.get(`${baseUrl}/api/resource/Item`, {
          headers: this.authHeaders,
          params: {
            fields: JSON.stringify([
              // Standard fields
              'name', 'item_code', 'item_name', 'description',
              'item_group', 'brand', 'gst_hsn_code',
              'weight_per_unit', 'weight_uom', 'stock_uom',
              'has_variants', 'variant_of',
              'standard_rate', 'valuation_rate',
              'image', 'country_of_origin',
              // Confirmed valid custom fields (verified against live ERPNext)
              // ❌ custom_amazon_asin  — NOT valid in list query (read from full item fetch)
              // ❌ custom_material     — does not exist in this ERPNext
              'custom_sync_marketplace',
              'custom_thumbnail_image',
              'custom_amazon',
              'custom_flipkart',
              'custom_mrp',
              'custom_amazon_price',
              'custom_flipkart_price',
              'default_item_manufacturer',
            ]),
            filters: JSON.stringify(filters),
            limit_page_length: params?.pageSize || 500,
          },
        });
      } catch (httpErr: any) {
        const status = httpErr?.status || 'unknown';
        const body = httpErr?.data || httpErr?.response?.data;
        const bodyStr = body ? JSON.stringify(body) : httpErr.message;
        this.logger.error(`ERPNext Item list failed — HTTP ${status}: ${bodyStr}`);
        throw new Error(`HTTP ${status} from ERPNext /api/resource/Item — ${bodyStr}`);
      }

      const itemsData: any[] = listResponse.data?.data || [];
      this.logger.log(`ERPNext returned ${itemsData.length} items for sync`);

      // ── Step 2: Enrich each item with barcodes, attributes, and images ──
      const items: NormalizedProduct[] = await Promise.all(itemsData.map(async (listItem: any) => {
        let images: string[] = [];

        // Build image list — prefer custom_thumbnail_image, fall back to image
        const thumbSrc = listItem.custom_thumbnail_image || listItem.image;
        if (thumbSrc) {
          const clean = thumbSrc.startsWith('/') ? thumbSrc.substring(1) : thumbSrc;
          images.push(clean.startsWith('http') ? clean : `${baseUrl}/${clean}`);
        }

        // Custom fields are now in the list response directly ✅
        const customAmazon   = listItem.custom_amazon   === 1 || listItem.custom_amazon   === true;
        const customFlipkart = listItem.custom_flipkart === 1 || listItem.custom_flipkart === true;
        const customMrp      = listItem.custom_mrp || 0;
        const customAmazonPrice      = listItem.custom_amazon_price   || undefined;
        const customFlipkartPrice    = listItem.custom_flipkart_price || undefined;
        const customAmazonProductType = listItem.custom_amazon_product_type || undefined;

        // These require the full item doc (not available as list fields)
        let upc = '';
        let amazonAsin = '';
        let variantAttributes: { name: string; value: string }[] = [];
        let variationTheme: string | undefined;

        let full: any = null;

        try {
          // Full item fetch — returns entire document, gets barcodes/attributes/amazon_asin
          const fullRes = await this.http.get(
            `${baseUrl}/api/resource/Item/${encodeURIComponent(listItem.item_code)}`,
            { headers: this.authHeaders },
          );
          full = fullRes.data?.data;

          if (full) {
            // Amazon ASIN (custom_amazon_asin not valid in list query but exists in full doc)
            amazonAsin = full.custom_amazon_asin || '';

            // UPC from barcodes child table
            if (full.barcodes?.length > 0) {
              const upcEntry = full.barcodes.find((b: any) => b.barcode_type === 'UPC');
              upc = upcEntry ? upcEntry.barcode : full.barcodes[0].barcode;
            }

            // Variant attributes
            if (full.attributes?.length > 0) {
              variantAttributes = full.attributes.map((a: any) => ({
                name: a.attribute,
                value: a.attribute_value,
              }));
              const hasColor = variantAttributes.some(a =>
                a.name.toLowerCase() === 'colour' || a.name.toLowerCase() === 'color',
              );
              const hasSize = variantAttributes.some(a => a.name.toLowerCase() === 'size');
              if (hasColor && hasSize) variationTheme = 'COLOR_SIZE';
              else if (hasColor) variationTheme = 'COLOR';
              else if (hasSize) variationTheme = 'SIZE';
            }
          }

          // ── Step 3: Fetch attached File records for images ──────────────
          const addImagesForCode = async (code: string) => {
            try {
              const filesRes = await this.http.get(`${baseUrl}/api/resource/File`, {
                headers: this.authHeaders,
                params: {
                  fields: JSON.stringify(['file_url']),
                  filters: JSON.stringify([
                    ['attached_to_doctype', '=', 'Item'],
                    ['attached_to_name', '=', code],
                  ]),
                },
              });
              for (const f of filesRes.data?.data || []) {
                if (f.file_url) {
                  const clean = f.file_url.startsWith('/') ? f.file_url.substring(1) : f.file_url;
                  const url = clean.startsWith('http') ? clean : `${baseUrl}/${clean}`;
                  if (!images.includes(url)) images.push(url);
                }
              }
            } catch { /* ignore image fetch errors */ }
          };

          await addImagesForCode(listItem.item_code);

          // Image inheritance: if no images found, try parent template
          if (images.length === 0 && listItem.variant_of) {
            await addImagesForCode(listItem.variant_of);
          }

        } catch (e: any) {
          this.logger.warn(`Could not fully fetch item ${listItem.item_code}: ${e.message}`);
        }

        return {
          sku: listItem.item_code,
          name: listItem.item_name,
          description: listItem.description,
          category: listItem.item_group,
          brand: listItem.brand,
          mrp: customMrp || listItem.standard_rate || 0,
          sellingPrice: listItem.standard_rate || 0,
          hsnCode: listItem.gst_hsn_code,
          weight: listItem.weight_per_unit,
          customAmazon,
          customFlipkart,
          customAmazonPrice,
          customFlipkartPrice,
          amazonProductType: customAmazonProductType,
          upc,
          amazonAsin,
          valuationRate: listItem.valuation_rate || 0,
          isParent: listItem.has_variants === 1,
          variantOf: listItem.variant_of || undefined,
          variationTheme,
          variantAttributes: variantAttributes.length > 0 ? variantAttributes : undefined,
          thumbnailUrl: images.length > 0 ? images[0] : undefined,
          images,
          customItemTypeName: full?.custom_item_type_name || listItem.custom_item_type_name,
          customModelName: full?.custom_model_name || listItem.custom_model_name,
          customStyle: full?.custom_style || listItem.custom_style,
          customNumberOfItems: full?.custom_number_of_items || listItem.custom_number_of_items ? parseInt(full?.custom_number_of_items || listItem.custom_number_of_items, 10) : undefined,
          customColor: full?.custom_color || listItem.custom_color,
          customNumberOfPieces: full?.custom_number_of_pieces || listItem.custom_number_of_pieces ? parseInt(full?.custom_number_of_pieces || listItem.custom_number_of_pieces, 10) : undefined,
          customModelNumber: full?.custom_model_number || listItem.custom_model_number,
          customManufacturerContactInfo: full?.custom__manufacturer_contact_information || listItem.custom__manufacturer_contact_information,
          customRequiredAssembly: (full?.custom_required_assembly ?? listItem.custom_required_assembly) !== undefined ? Boolean(full?.custom_required_assembly ?? listItem.custom_required_assembly) : undefined,
          customDepth: (full?.custom_depth ?? listItem.custom_depth) !== undefined ? parseFloat(full?.custom_depth ?? listItem.custom_depth) : undefined,
          customWidth: (full?.custom_width ?? listItem.custom_width) !== undefined ? parseFloat(full?.custom_width ?? listItem.custom_width) : undefined,
          customHeight: (full?.custom_height ?? listItem.custom_height) !== undefined ? parseFloat(full?.custom_height ?? listItem.custom_height) : undefined,
          customNumberOfPacks: (full?.custom_number_of_packs ?? listItem.custom_number_of_packs) !== undefined ? parseFloat(full?.custom_number_of_packs ?? listItem.custom_number_of_packs) : undefined,
          customExternalProductInformation: full?.custom__external_product_information ?? listItem.custom__external_product_information,
          customShelfThickness: (full?.custom_shelf_thickness ?? listItem.custom_shelf_thickness) !== undefined ? parseFloat(full?.custom_shelf_thickness ?? listItem.custom_shelf_thickness) : undefined,
          customAssemblyInstructions: full?.custom_assembly_instructions ?? listItem.custom_assembly_instructions,
          customUnit: full?.custom_unit ?? listItem.custom_unit,
          customItemShape: full?.custom_item_shape ?? listItem.custom_item_shape,
          customShelfType: full?.custom__shelf_type ?? listItem.custom__shelf_type,
          customNumberOfShelves: (full?.custom_number_of_shelves ?? listItem.custom_number_of_shelves) !== undefined ? parseInt(full?.custom_number_of_shelves ?? listItem.custom_number_of_shelves, 10) : undefined,
          customMountingType: full?.custom_mounting_type ?? listItem.custom_mounting_type,
          customFinishType: full?.custom_finish_type ?? listItem.custom_finish_type,
          customSelectMaterial: full?.custom_select_material ?? listItem.custom_select_material,
          customIncludedComponents: full?.custom_included_components ?? listItem.custom_included_components,
          customAmazonBulletPoint: full?.custom_amazon_bullet_point ?? listItem.custom_amazon_bullet_point,
          customPackerContactInformation: full?.custom_packer_contact_information ?? listItem.custom_packer_contact_information,
          customSpecificUsesForProduct: full?.custom_specific_uses_for_product ?? listItem.custom_specific_uses_for_product,
          customRecommendedUsesForProduct: full?.custom_recommended_uses_for_product ?? listItem.custom_recommended_uses_for_product,
          customRoomType: full?.custom_room_type ?? listItem.custom_room_type,
          customSpecialFeature: full?.custom_special_feature ?? listItem.custom_special_feature,
          customCareInstructions: full?.custom_care_instructions ?? listItem.custom_care_instructions,
          attributes: { ...listItem, ...(full || {}) },
          rawPayload: full ? { ...listItem, ...full } : listItem,
        };

      }));

      return this.success({
        items,
        total: items.length,
        page: 1,
        pageSize: params?.pageSize || 500,
        hasMore: false,
      });
    } catch (error) {
      return this.failure(error);
    }
  }


  // ─── Schema / Meta ────────────────────────────────────────────────────────
  
  async getItemFields(): Promise<ConnectorResult<{ fieldname: string; label: string; fieldtype: string }[]>> {
    try {
      const baseUrl = this.baseUrl.replace(/\/$/, '');
      const customFieldsRes = await this.http.get(`${baseUrl}/api/resource/Custom Field`, {
        headers: this.authHeaders,
        params: {
          filters: JSON.stringify([['dt', '=', 'Item']]),
          fields: JSON.stringify(['fieldname', 'label', 'fieldtype']),
          limit_page_length: 500,
        },
      });

      const stdFields: any[] = [];
      const customFields = customFieldsRes.data?.data || [];

      return this.success([...stdFields, ...customFields]);
    } catch (error) {
      this.logger.error(`Failed to fetch Item fields: ${error.message}`);
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
    } catch (error: any) {
      if (error.response && error.response.data) {
        this.logger.error(`ERPNext Sales Order Creation Failed: ${JSON.stringify(error.response.data)}`);
      }
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
