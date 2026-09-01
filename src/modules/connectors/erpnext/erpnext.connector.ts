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

  async updateItem(itemCode: string, fields: Record<string, any>): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.put(
        `${this.baseUrl}/api/resource/Item/${encodeURIComponent(itemCode)}`,
        fields,
        { headers: this.authHeaders }
      );
      this.logger.log(`Successfully updated item ${itemCode} in ERPNext`);
      return this.success(response.data?.data);
    } catch (error: any) {
      let errMsg = error.message;
      const responseData = error.response?.data || error.data;
      if (responseData) {
        try {
          if (responseData._server_messages) {
            errMsg = JSON.parse(JSON.parse(responseData._server_messages)[0]).message;
          } else {
            errMsg = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
          }
        } catch (e) {
          errMsg = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
        }
      }
      this.logger.error(`Failed to update item ${itemCode} in ERPNext: ${errMsg}`);
      return this.failure(errMsg);
    }
  }

  async patchItem(itemCode: string, fields: Record<string, any>): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.patch(
        `${this.baseUrl}/api/v2/document/Item/${encodeURIComponent(itemCode)}`,
        fields,
        { headers: this.authHeaders }
      );
      this.logger.log(`Successfully patched item ${itemCode} in ERPNext`);
      return this.success(response.data?.data);
    } catch (error: any) {
      let errMsg = error.message;
      const responseData = error.response?.data || error.data;
      if (responseData) {
        try {
          if (responseData.errors && responseData.errors.length > 0) {
            errMsg = responseData.errors[0].message || responseData.errors[0].type;
          } else if (responseData._server_messages) {
            errMsg = JSON.parse(JSON.parse(responseData._server_messages)[0]).message;
          } else {
            errMsg = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
          }
        } catch (e) {
          errMsg = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
        }
      }
      this.logger.error(`Failed to patch item ${itemCode} in ERPNext: ${errMsg}`);
      return this.failure(errMsg);
    }
  }




  async fetchItemAttributes(): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.get(
        `${this.baseUrl}/api/method/get_item_attributes`,
        { headers: this.authHeaders }
      );
      return this.success(response.data);
    } catch (error) {
      return this.failure(error);
    }
  }

  async fetchItemAttachments(itemCode: string): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.get(
        `${this.baseUrl}/api/resource/File`,
        {
          headers: this.authHeaders,
          params: {
            fields: JSON.stringify(['name', 'file_url', 'file_name', 'is_private']),
            filters: JSON.stringify([
              ['attached_to_doctype', '=', 'Item'],
              ['attached_to_name', '=', itemCode]
            ])
          }
        }
      );
      return this.success(response.data?.data || []);
    } catch (error) {
      this.logger.error(`Failed to fetch attachments for ${itemCode}`, error);
      return this.failure(error);
    }
  }

  async deleteAttachment(fileName: string): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.delete(
        `${this.baseUrl}/api/resource/File/${encodeURIComponent(fileName)}`,
        { headers: this.authHeaders }
      );
      return this.success(response.data);
    } catch (error) {
      this.logger.error(`Failed to delete attachment ${fileName}`, error);
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
      const baseUrl = this.baseUrl.replace(/\/$/, '');

      const filters: any[] = [];
      if (params?.brand && params.brand !== 'All') {
        filters.push(['brand', '=', params.brand]);
      }

      if (params?.excludeVariants) {
        // Exclude items that are variants of another item (meaning we keep masters and simple items)
        filters.push(['variant_of', 'is', 'not set']);
      }

      const queryParams: any = {
        limit_start: params?.limit_start || 0,
        limit_page_length: params?.pageSize || 500,
        fields: JSON.stringify(['*']),
        order_by: 'creation desc',
      };

      if (params?.search) {
        queryParams.or_filters = JSON.stringify([
          ['item_code', 'like', `%${params.search}%`],
          ['item_name', 'like', `%${params.search}%`]
        ]);
      }

      if (filters.length > 0) {
        queryParams.filters = JSON.stringify(filters);
      }

      const queryString = new URLSearchParams(queryParams).toString();
      const endpointUrl = `${baseUrl}/api/resource/Item?${queryString}`;

      let listResponse: any;
      try {
        listResponse = await this.http.get(endpointUrl, {
          headers: this.authHeaders,
        });
      } catch (httpErr: any) {
        const status = httpErr?.status || 'unknown';
        const body = httpErr?.data || httpErr?.response?.data;
        const bodyStr = body ? JSON.stringify(body) : httpErr.message;
        this.logger.error(`ERPNext Item fetch failed — HTTP ${status}: ${bodyStr}`);
        throw new Error(`HTTP ${status} from ERPNext /api/resource/Item — ${bodyStr}`);
      }

      const itemsData: any[] = listResponse.data?.data || [];
      
      let totalItems = itemsData.length;
      if (itemsData.length === queryParams.limit_page_length || params?.limit_start > 0) {
        try {
          const countParams: any = { limit_page_length: 0, fields: JSON.stringify(['name']) };
          if (filters.length > 0) countParams.filters = JSON.stringify(filters);
          const countRes = await this.http.get(`${baseUrl}/api/resource/Item?${new URLSearchParams(countParams).toString()}`, { headers: this.authHeaders });
          totalItems = countRes.data?.data?.length || totalItems;
        } catch (e: any) {
          this.logger.warn('Failed to fetch total count for products: ' + e.message);
        }
      }

      this.logger.log(`ERPNext returned ${itemsData.length} items out of ${totalItems} for sync`);

      const items: any[] = itemsData.map((listItem: any) => {
        const customAmazon = listItem.custom_amazon === 1 || listItem.custom_amazon === true;
        const customFlipkart = listItem.custom_flipkart === 1 || listItem.custom_flipkart === true;
        const customMrp = listItem.custom_mrp || 0;

        return {
          ...listItem, // Add payload data directly to the frontend
          sku: listItem.item_code,
          name: listItem.item_name,
          mrp: customMrp || listItem.standard_rate || 0,
          sellingPrice: listItem.standard_rate || 0,
          customAmazon,
          customFlipkart,
          rawPayload: listItem,
        };
      });

      return this.success({
        items,
        total: totalItems,
        page: 1,
        pageSize: params?.pageSize || 500,
        hasMore: false,
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  async fetchVariants(sku: string): Promise<ConnectorResult<NormalizedProduct[]>> {
    try {
      const baseUrl = this.baseUrl.replace(/\/$/, '');
      const filters = JSON.stringify([['variant_of', '=', sku]]);
      const queryParams = {
        limit_page_length: 500,
        fields: JSON.stringify(['*']),
        filters,
        order_by: 'creation desc',
      };
      const queryString = new URLSearchParams(queryParams as any).toString();
      const endpointUrl = `${baseUrl}/api/resource/Item?${queryString}`;

      const response = await this.http.get(endpointUrl, { headers: this.authHeaders });
      
      const itemsData = response.data?.data || [];
      const items: any[] = itemsData.map((listItem: any) => {
        const customAmazon = listItem.custom_amazon === 1 || listItem.custom_amazon === true;
        const customFlipkart = listItem.custom_flipkart === 1 || listItem.custom_flipkart === true;
        const customMrp = listItem.custom_mrp || 0;

        return {
          ...listItem, // Add payload data directly to the frontend
          sku: listItem.item_code,
          name: listItem.item_name,
          mrp: customMrp || listItem.standard_rate || 0,
          sellingPrice: listItem.standard_rate || 0,
          customAmazon,
          customFlipkart,
          rawPayload: listItem,
        };
      });

      return this.success(items);
    } catch (error) {
      return this.failure(error);
    }
  }


  // ─── Schema / Meta ────────────────────────────────────────────────────────

  async getItemFields(): Promise<ConnectorResult<any[]>> {
    try {
      const baseUrl = this.baseUrl.replace(/\/$/, '');
      const customFieldsRes = await this.http.get(`${baseUrl}/api/resource/Custom Field`, {
        headers: this.authHeaders,
        params: {
          filters: JSON.stringify([['dt', '=', 'Item']]),
          fields: JSON.stringify(['fieldname', 'label', 'fieldtype', 'options', 'fetch_from', 'default']),
          limit_page_length: 500,
        },
      });

      const docTypeRes = await this.http.get(`${baseUrl}/api/resource/DocType/Item`, {
        headers: this.authHeaders,
      });

      const stdFieldsRaw = docTypeRes.data?.data?.fields || [];
      const customFieldsRaw = customFieldsRes.data?.data || [];

      // Normalize standard fields (rename 'default' to 'default_value')
      const stdFields = stdFieldsRaw.map((f: any) => ({
        fieldname: f.fieldname,
        label: f.label,
        fieldtype: f.fieldtype,
        options: f.options,
        fetch_from: f.fetch_from,
        default_value: f.default,
      }));

      // Normalize custom fields (make sure they match)
      const customFields = customFieldsRaw.map((f: any) => ({
        fieldname: f.fieldname,
        label: f.label,
        fieldtype: f.fieldtype,
        options: f.options,
        fetch_from: f.fetch_from,
        default_value: f.default,
      }));

      return this.success([...stdFields, ...customFields]);
    } catch (error) {
      this.logger.error(`Failed to fetch Item fields: ${error.message}`);
      return this.failure(error);
    }
  }

  /**
   * Fetches Item doctype meta via ERPNext v2 API.
   * Returns fields with is_system_generated, reqd, collapsible, insert_after etc.
   * is_system_generated=1 => default/standard field; =0 => custom field
   */
  async getItemMetaV2(): Promise<ConnectorResult<any[]>> {
    try {
      const baseUrl = this.baseUrl.replace(/\/$/, '');
      const response = await this.http.get(
        `${baseUrl}/api/v2/doctype/Item/meta`,
        { headers: this.authHeaders },
      );

      // v2 response: { data: { fields: [...] } } or { fields: [...] }
      const fields: any[] =
        response.data?.data?.fields ||
        response.data?.fields ||
        response.data?.docs?.[0]?.fields ||
        [];

      return this.success(fields);
    } catch (error: any) {
      this.logger.error(`Failed to fetch Item meta v2: ${error.message}`);
      return this.failure(error);
    }
  }

  /**
   * Call any ERPNext Frappe method via POST.
   * Used as a public alternative to the private `http` property.
   */
  async callErpNextMethod(method: string, data?: Record<string, any>): Promise<any> {
    try {
      const baseUrl = this.baseUrl.replace(/\/$/, '');
      const response = await this.http.post(
        `${baseUrl}/api/method/${method}`,
        data || {},
        { headers: this.authHeaders }
      );
      return response.data?.message ?? response.data;
    } catch (error: any) {
      const errMsg = error.response?.data?._server_messages
        ? JSON.parse(JSON.parse(error.response.data._server_messages)[0]).message
        : (error.response?.data?.message || error.message);
      throw new Error(errMsg);
    }
  }


  async getOrderFields(): Promise<ConnectorResult<any[]>> {
    try {
      const baseUrl = this.baseUrl.replace(/\/$/, '');
      const customFieldsRes = await this.http.get(`${baseUrl}/api/resource/Custom Field`, {
        headers: this.authHeaders,
        params: {
          filters: JSON.stringify([['dt', '=', 'Sales Order']]),
          fields: JSON.stringify(['fieldname', 'label', 'fieldtype', 'options', 'fetch_from', 'default']),
          limit_page_length: 500,
        },
      });

      const docTypeRes = await this.http.get(`${baseUrl}/api/resource/DocType/Sales Order`, {
        headers: this.authHeaders,
      });

      const customFieldsItemRes = await this.http.get(`${baseUrl}/api/resource/Custom Field`, {
        headers: this.authHeaders,
        params: {
          filters: JSON.stringify([['dt', '=', 'Sales Order Item']]),
          fields: JSON.stringify(['fieldname', 'label', 'fieldtype', 'options', 'fetch_from', 'default']),
          limit_page_length: 500,
        },
      });

      const docTypeItemRes = await this.http.get(`${baseUrl}/api/resource/DocType/Sales Order Item`, {
        headers: this.authHeaders,
      });

      const stdFieldsRaw = docTypeRes.data?.data?.fields || [];
      const customFieldsRaw = customFieldsRes.data?.data || [];
      const itemStdFieldsRaw = docTypeItemRes.data?.data?.fields || [];
      const itemCustomFieldsRaw = customFieldsItemRes.data?.data || [];

      const mapField = (f: any, doctype: string) => ({
        fieldname: f.fieldname,
        label: f.label,
        fieldtype: f.fieldtype,
        options: f.options,
        fetch_from: f.fetch_from,
        default_value: f.default,
        doctype,
      });

      const stdFields = stdFieldsRaw.map((f: any) => mapField(f, 'Sales Order'));
      const customFields = customFieldsRaw.map((f: any) => mapField(f, 'Sales Order'));
      const itemStdFields = itemStdFieldsRaw.map((f: any) => mapField(f, 'Sales Order Item'));
      const itemCustomFields = itemCustomFieldsRaw.map((f: any) => mapField(f, 'Sales Order Item'));

      return this.success([...stdFields, ...customFields, ...itemStdFields, ...itemCustomFields]);
    } catch (error) {
      this.logger.error(`Failed to fetch Sales Order fields: ${error.message}`);
      return this.failure(error);
    }
  }

  async getCustomerFields(): Promise<ConnectorResult<any[]>> {
    try {
      const baseUrl = this.baseUrl.replace(/\/$/, '');
      const customFieldsRes = await this.http.get(`${baseUrl}/api/resource/Custom Field`, {
        headers: this.authHeaders,
        params: {
          filters: JSON.stringify([['dt', '=', 'Customer']]),
          fields: JSON.stringify(['fieldname', 'label', 'fieldtype', 'options', 'fetch_from', 'default']),
          limit_page_length: 500,
        },
      });

      const docTypeRes = await this.http.get(`${baseUrl}/api/resource/DocType/Customer`, {
        headers: this.authHeaders,
      });

      const stdFieldsRaw = docTypeRes.data?.data?.fields || [];
      const customFieldsRaw = customFieldsRes.data?.data || [];

      const stdFields = stdFieldsRaw.map((f: any) => ({
        fieldname: f.fieldname,
        label: f.label,
        fieldtype: f.fieldtype,
        options: f.options,
        fetch_from: f.fetch_from,
        default_value: f.default,
      }));

      const customFields = customFieldsRaw.map((f: any) => ({
        fieldname: f.fieldname,
        label: f.label,
        fieldtype: f.fieldtype,
        options: f.options,
        fetch_from: f.fetch_from,
        default_value: f.default,
      }));

      return this.success([...stdFields, ...customFields]);
    } catch (error) {
      this.logger.error(`Failed to fetch Customer fields: ${error.message}`);
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

  async createSalesOrder(data: any): Promise<ConnectorResult<any>> {
    try {
      this.logger.log(`Sending Sales Order Payload: ${JSON.stringify(data, null, 2)}`);
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

  async getSalesOrderByMarketplaceId(marketplaceOrderId: string): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.post(
        `${this.baseUrl}/api/method/frappe.client.get_list`,
        {
          doctype: 'Sales Order',
          filters: [
            ['custom_marketplace_order_id', '=', marketplaceOrderId]
          ],
          fields: ['name', 'custom_marketplace_order_id']
        },
        { headers: this.authHeaders }
      );
      
      const orders = response.data?.message || [];
      if (orders.length > 0) {
        return this.success(orders[0]); // Returns the first matching order
      }
      return this.success(null); // No order found
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

  async getOrCreateCustomer(data: any): Promise<ConnectorResult<any>> {
    try {
      // Try to find existing customer by email_id or customer_name
      const filters = [];
      if (data.email_id) {
        filters.push(['email_id', '=', data.email_id]);
      } else if (data.customer_name) {
        filters.push(['customer_name', '=', data.customer_name]);
      }

      if (filters.length > 0) {
        const existing = await this.http.get(`${this.baseUrl}/api/resource/Customer`, {
          headers: this.authHeaders,
          params: {
            filters: JSON.stringify(filters),
            fields: JSON.stringify(['name', 'customer_name']),
          },
        });
        if (existing.data?.data?.length > 0) {
          return this.success(existing.data.data[0]);
        }
      }

      // Create new customer using dynamic payload
      const response = await this.http.post(
        `${this.baseUrl}/api/resource/Customer`,
        data,
        { headers: this.authHeaders },
      );
      return this.success(response.data?.data);
    } catch (error) {
      return this.failure(error);
    }
  }

  async createAddress(data: any): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.post(
        `${this.baseUrl}/api/resource/Address`,
        data,
        { headers: this.authHeaders }
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

  async createItem(fields: Record<string, any>): Promise<ConnectorResult<any>> {
    try {
      await this.authenticate();

      const payload = {
        item_group: 'Products', // Default fallback
        stock_uom: 'Nos',
        is_stock_item: 1,
        ...fields
      };

      const response = await this.http.post(
        `${this.baseUrl}/api/resource/Item`,
        payload,
        { headers: this.authHeaders },
      );

      return this.success(response.data?.data);
    } catch (error: any) {
      let errMsg = error.message;
      const responseData = error.response?.data || error.data;
      if (responseData) {
        try {
          if (responseData._server_messages) {
            errMsg = JSON.parse(JSON.parse(responseData._server_messages)[0]).message;
          } else {
            errMsg = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
          }
        } catch (e) {
          errMsg = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
        }
      }
      this.logger.error(`Failed to create ERPNext item: ${errMsg}`);
      return this.failure(errMsg);
    }
  }
  async attachFileToItem(itemCode: string, fileUrl: string): Promise<ConnectorResult<any>> {
    try {
      await this.authenticate();
      const payload = {
        file_url: fileUrl,
        attached_to_doctype: 'Item',
        attached_to_name: itemCode,
        is_private: 0
      };
      const response = await this.http.post(
        `${this.baseUrl}/api/resource/File`,
        payload,
        { headers: this.authHeaders }
      );
      return this.success(response.data?.data);
    } catch (error: any) {
      this.logger.error(`Failed to attach file to item: ${error.message}`);
      return this.failure(error.message);
    }
  }

  async uploadFile(file: any): Promise<ConnectorResult<any>> {
    try {
      await this.authenticate();
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', file.buffer, { filename: file.originalname });
      formData.append('is_private', '0');

      const response = await this.http.post(
        `${this.baseUrl}/api/method/upload_file`,
        formData,
        {
          headers: {
            ...this.authHeaders,
            ...formData.getHeaders(),
          },
        }
      );
      return this.success(response.data?.message);
    } catch (error: any) {
      this.logger.error(`Failed to upload file to ERPNext: ${error.message}`);
      return this.failure(error.message);
    }
  }

  /**
   * Upload a file buffer to ERPNext and attach it directly to an Item record.
   * Uses POST /api/method/upload_file with doctype=Item and docname={{itemCode}}.
   */
  async uploadFileToItem(file: any, itemCode: string): Promise<ConnectorResult<any>> {
    try {
      await this.authenticate();
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', file.buffer, { filename: file.originalname });
      formData.append('doctype', 'Item');
      formData.append('docname', itemCode);
      formData.append('is_private', '0');

      const response = await this.http.post(
        `${this.baseUrl}/api/method/upload_file`,
        formData,
        {
          headers: {
            ...this.authHeaders,
            ...formData.getHeaders(),
          },
        }
      );
      return this.success(response.data?.message);
    } catch (error: any) {
      this.logger.error(`Failed to upload file to item ${itemCode}: ${error.message}`);
      return this.failure(error.message);
    }
  }


  async getReferenceData(): Promise<ConnectorResult<any>> {
    try {
      const fetchList = async (doctype: string) => {
        const response = await this.http.get(`${this.baseUrl}/api/resource/${doctype}`, {
          headers: this.authHeaders,
          params: {
            fields: JSON.stringify(['name']),
            limit_page_length: 1000,
          },
        });
        return (response.data?.data || []).map((d: any) => d.name);
      };

      const [brands, itemGroups, uoms, hsnCodes] = await Promise.all([
        fetchList('Brand').catch(() => []),
        fetchList('Item Group').catch(() => []),
        fetchList('UOM').catch(() => []),
        fetchList('GST HSN Code').catch(() => []),
      ]);

      return this.success({
        brands,
        itemGroups,
        uoms,
        hsnCodes,
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  private cachedItemSchema: any = null;
  private cachedItemSchemaTimestamp: number = 0;
  
  private cachedSchemas: Record<string, { schema: any, timestamp: number }> = {};
  
  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  async getItemSchema(): Promise<ConnectorResult<any>> {
    if (this.cachedItemSchema && (Date.now() - this.cachedItemSchemaTimestamp < this.CACHE_TTL_MS)) {
      return this.success(this.cachedItemSchema);
    }
    
    try {
      const response = await this.http.get(`${this.baseUrl}/api/method/frappe.desk.form.load.getdoctype?doctype=Item`, {
        headers: this.authHeaders,
      });
      const schema = response.data?.docs?.[0]?.fields || [];
      this.cachedItemSchema = schema;
      this.cachedItemSchemaTimestamp = Date.now();
      return this.success(schema);
    } catch (error) {
      return this.failure(error);
    }
  }

  async getDoctypeSchema(doctype: string): Promise<ConnectorResult<any>> {
    if (this.cachedSchemas[doctype] && (Date.now() - this.cachedSchemas[doctype].timestamp < this.CACHE_TTL_MS)) {
      return this.success(this.cachedSchemas[doctype].schema);
    }
    
    try {
      const response = await this.http.get(`${this.baseUrl}/api/method/frappe.desk.form.load.getdoctype?doctype=${encodeURIComponent(doctype)}`, {
        headers: this.authHeaders,
      });
      const schema = response.data?.docs?.[0]?.fields || [];
      this.cachedSchemas[doctype] = {
        schema,
        timestamp: Date.now()
      };
      return this.success(schema);
    } catch (error) {
      return this.failure(error);
    }
  }

  async getFullItem(itemCode: string): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.get(`${this.baseUrl}/api/resource/Item/${encodeURIComponent(itemCode)}`, {
        headers: this.authHeaders,
      });
      return this.success(response.data?.data);
    } catch (error: any) {
      if (error?.status === 404 || error?.response?.status === 404 || error?.message?.includes('404')) {
        return { success: false, error: 'Not found' };
      }
      return this.failure(error);
    }
  }

  async getLinkOptions(doctype: string, query?: string): Promise<ConnectorResult<any[]>> {
    try {
      const params: any = {
        fields: JSON.stringify(['name']),
        limit_page_length: 9999,
      };
      if (query) {
        params.filters = JSON.stringify([['name', 'like', `%${query}%`]]);
      }
      const response = await this.http.get(`${this.baseUrl}/api/resource/${encodeURIComponent(doctype)}`, {
        headers: this.authHeaders,
        params,
      });
      // Return full objects (with at least `name`) so consumers can use name for Table MultiSelect submissions
      return this.success(response.data?.data || []);
    } catch (error) {
      return this.failure(error);
    }
  }

  async getDocuments(doctype: string, names: string[]): Promise<ConnectorResult<any[]>> {
    if (!names || names.length === 0) {
      return this.success([]);
    }
    try {
      const params: any = {
        fields: JSON.stringify(['*']),
        limit_page_length: names.length,
        filters: JSON.stringify([['name', 'in', names]]),
      };
      const response = await this.http.get(`${this.baseUrl}/api/resource/${encodeURIComponent(doctype)}`, {
        headers: this.authHeaders,
        params,
      });
      return this.success(response.data?.data || []);
    } catch (error) {
      return this.failure(error);
    }
  }

  async deleteItem(itemCode: string): Promise<ConnectorResult<boolean>> {
    try {
      const response = await this.http.delete(`${this.baseUrl}/api/resource/Item/${encodeURIComponent(itemCode)}`, {
        headers: this.authHeaders,
      });
      return this.success(true);
    } catch (error: any) {
      if (error.response?.status === 404) {
        return this.success(true); // Ignore if already deleted/not found
      }
      return this.failure(error);
    }
  }

  async attachFile(doctype: string, docname: string, fileUrl: string): Promise<ConnectorResult<any>> {
    try {
      // 1. Check if file is already attached
      const listResponse = await this.http.post(
        `${this.baseUrl}/api/method/frappe.client.get_list`,
        {
          doctype: 'File',
          filters: [
            ['attached_to_doctype', '=', doctype],
            ['attached_to_name', '=', docname]
          ],
          fields: ['name', 'file_url']
        },
        { headers: this.authHeaders }
      );
      
      const existingFiles = listResponse.data?.message || [];
      const alreadyAttached = existingFiles.some((f: any) => f.file_url === fileUrl || fileUrl.includes(f.file_url) || f.file_url.includes(fileUrl));

      if (alreadyAttached) {
        return this.success({ message: "Already attached" });
      }

      // 2. Attach the file
      const fileName = fileUrl.split('/').pop()?.split('?')[0] || `image_${Date.now()}.jpg`;
      const payload = {
        file_url: fileUrl,
        file_name: fileName,
        attached_to_doctype: doctype,
        attached_to_name: docname,
        is_private: 0
      };
      const response = await this.http.post(`${this.baseUrl}/api/resource/File`, payload, {
        headers: this.authHeaders,
      });
      return this.success(response.data?.data);
    } catch (error) {
      return this.failure(error);
    }
  }

  async removeAttachedFile(doctype: string, docname: string, fileUrl: string): Promise<ConnectorResult<boolean>> {
    try {
      console.log(`[removeAttachedFile] Fetching files for ${doctype} ${docname}`);
      // 1. Fetch files attached to this doc
      const listResponse = await this.http.post(
        `${this.baseUrl}/api/method/frappe.client.get_list`,
        {
          doctype: 'File',
          filters: [
            ['attached_to_doctype', '=', doctype],
            ['attached_to_name', '=', docname]
          ],
          fields: ['name', 'file_name', 'file_url']
        },
        { headers: this.authHeaders }
      );
      
      const files = listResponse.data?.message || [];
      console.log(`[removeAttachedFile] Found ${files.length} files attached:`, files);
      
      const filesToDelete = files.filter((f: any) => f.file_url === fileUrl || fileUrl.includes(f.file_url) || f.file_url.includes(fileUrl));

      if (filesToDelete.length === 0) {
        console.warn(`[removeAttachedFile] Could not find file matching ${fileUrl} in `, files);
        return this.success(true); // Already gone or not attached
      }

      for (const fileToDelete of filesToDelete) {
        console.log(`[removeAttachedFile] Deleting file fid=${fileToDelete.name} via REST API`);
        // 2. Remove the attachment using standard REST API
        try {
          await this.http.delete(
            `${this.baseUrl}/api/resource/File/${encodeURIComponent(fileToDelete.name)}`,
            { headers: this.authHeaders }
          );
          console.log(`[removeAttachedFile] Successfully deleted ${fileToDelete.name} via REST API`);
        } catch (delErr: any) {
          console.warn(`[removeAttachedFile] REST API delete failed for ${fileToDelete.name}, trying remove_attach method...`);
          // Fallback to remove_attach method using POST (since Frappe methods always accept POST)
          await this.http.post(
            `${this.baseUrl}/api/method/frappe.desk.form.utils.remove_attach`,
            {
              fid: fileToDelete.name,
              dt: doctype,
              dn: docname
            },
            { headers: this.authHeaders }
          );
        }
      }

      return this.success(true);
    } catch (error: any) {
      console.error(`[removeAttachedFile] Error:`, error?.response?.data || error.message);
      return this.failure(error);
    }
  }

  /**
   * Fetch the fields schema for any ERPNext Doctype.
   * Used to discover the "value field" in Child Doctypes for Table mappings.
   */
  async getDocTypeFields(doctype: string): Promise<ConnectorResult<any[]>> {
    try {
      const response = await this.http.get(
        `${this.baseUrl}/api/resource/DocType/${encodeURIComponent(doctype)}`,
        { headers: this.authHeaders },
      );
      const fields = response.data?.data?.fields || [];
      // Filter out layout-only fields
      const dataFields = fields.filter((f: any) =>
        !['Column Break', 'Section Break', 'Tab Break', 'HTML'].includes(f.fieldtype),
      );
      return this.success(dataFields);
    } catch (error) {
      return this.failure(error);
    }
  }

  /**
   * Fetch all existing entries of a given Doctype (used for Child Table value resolution).
   * Optional nameFilter allows checking for a specific entry bypassing the 500 limit.
   */
  async getDocTypeEntries(doctype: string, nameFilter?: string): Promise<ConnectorResult<any[]>> {
    try {
      const params: any = {
        fields: JSON.stringify(['name']),
        limit_page_length: nameFilter ? 1 : 500,
      };
      if (nameFilter) {
        params.filters = JSON.stringify([['name', '=', nameFilter]]);
      }

      const response = await this.http.get(
        `${this.baseUrl}/api/resource/${encodeURIComponent(doctype)}`,
        {
          headers: this.authHeaders,
          params,
        },
      );
      return this.success(response.data?.data || []);
    } catch (error) {
      return this.failure(error);
    }
  }

  /**
   * Create a new document in the given ERPNext Doctype.
   * Used when an Amazon attribute value doesn't exist yet in a Child Doctype.
   */
  async createDocTypeEntry(doctype: string, data: Record<string, any>): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.post(
        `${this.baseUrl}/api/resource/${encodeURIComponent(doctype)}`,
        data,
        { headers: this.authHeaders },
      );
      return this.success(response.data?.data);
    } catch (error) {
      return this.failure(error);
    }
  }
  /**
   * Ensure that an Item Attribute and its specific value exist in ERPNext.
   */
  async ensureItemAttributeExists(attributeName: string, attributeValue: string): Promise<ConnectorResult<boolean>> {
    try {
      // 1. Check if Item Attribute exists
      let attributeExists = true;
      let attrDoc: any = null;
      try {
        const getRes = await this.http.get(
          `${this.baseUrl}/api/resource/Item Attribute/${encodeURIComponent(attributeName)}`,
          { headers: this.authHeaders },
        );
        attrDoc = getRes.data?.data;
      } catch (error: any) {
        if (error?.status === 404 || error?.response?.status === 404) {
          attributeExists = false;
        } else {
          throw error;
        }
      }

      // 2. If not exists, create Item Attribute with the value
      if (!attributeExists) {
        await this.http.post(
          `${this.baseUrl}/api/resource/Item Attribute`,
          {
            attribute_name: attributeName,
            custom_company: process.env.ERPNEXT_COMPANY || 'Woodwolf Studio (O) Pvt. Ltd',
            item_attribute_values: [
              { 
                attribute_value: String(attributeValue),
                abbr: String(attributeValue || 'VAL').substring(0, 10)
              }
            ]
          },
          { headers: this.authHeaders },
        );
        return this.success(true);
      }

      // 3. If exists, check if value exists, if not, append value
      const values = attrDoc.item_attribute_values || [];
      const valueExists = values.some((v: any) => v.attribute_value === attributeValue);

      if (!valueExists) {
        values.push({ 
          attribute_value: String(attributeValue),
          abbr: String(attributeValue || 'VAL').substring(0, 10)
        });
        await this.http.put(
          `${this.baseUrl}/api/resource/Item Attribute/${encodeURIComponent(attributeName)}`,
          {
            item_attribute_values: values
          },
          { headers: this.authHeaders },
        );
      }

      return this.success(true);
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Variant Creation ─────────────────────────────────────────────────────

  /**
   * Enqueue bulk variant creation in ERPNext.
   * Calls: POST api/method/erpnext.controllers.item_variant.enqueue_multiple_variant_creation
   *
   * @param payload.item              Template item code (e.g. "WW-SLF-N-COM")
   * @param payload.args              JSON string — attribute name → array of values
   *                                  e.g. '{"Furniture Finish":["Walnut Wood Finish"],"Grid Size":["5x5 Inch"]}'
   * @param payload.use_template_image  0 | 1
   */
  async enqueueMultipleVariantCreation(payload: {
    item: string;
    args: string;
    use_template_image: number;
  }): Promise<ConnectorResult<any>> {
    try {
      const response = await this.http.post(
        `${this.baseUrl}/api/method/erpnext.controllers.item_variant.enqueue_multiple_variant_creation`,
        payload,
        { headers: this.authHeaders },
      );
      this.logger.log(
        `Enqueued multiple variant creation for item "${payload.item}"`,
      );
      return this.success(response.data);
    } catch (error: any) {
      let errMsg = error.message;
      const responseData = error.response?.data || error.data;
      if (responseData) {
        try {
          if (responseData._server_messages) {
            errMsg = JSON.parse(JSON.parse(responseData._server_messages)[0]).message;
          } else {
            errMsg = typeof responseData === 'string'
              ? responseData
              : JSON.stringify(responseData);
          }
        } catch {
          errMsg = typeof responseData === 'string'
            ? responseData
            : JSON.stringify(responseData);
        }
      }
      this.logger.error(
        `Failed to enqueue multiple variant creation for "${payload.item}": ${errMsg}`,
      );
      return this.failure(errMsg);
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
  [key: string]: any;
}

export interface CreateCustomerDto {
  name: string;
  email?: string;
  phone?: string;
  territory?: string;
}
