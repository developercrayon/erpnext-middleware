import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientService } from '../../../shared/http-client.service';
import { BaseConnector } from '../base/base-connector.abstract';
import {
  ConnectorResult,
  NormalizedAddress,
  NormalizedInventory,
  NormalizedOrder,
  NormalizedOrderItem,
  NormalizedPrice,
  NormalizedProduct,
  NormalizedShipment,
  PaginatedResult,
} from '../base/connector.types';
import { FetchOrdersParams, FetchProductsParams, UpdateResult } from '../base/connector.interface';
import { MarketplaceSource } from '../../../database/entities/order.entity';

@Injectable()
export class FlipkartConnector extends BaseConnector {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly apiUrl: string;
  private readonly tokenUrl = 'https://api.flipkart.net/oauth-service/oauth/token';

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpClientService,
  ) {
    super('FlipkartConnector');
    this.appId = config.get<string>('flipkart.appId');
    this.appSecret = config.get<string>('flipkart.appSecret');
    this.apiUrl = config.get<string>('flipkart.apiUrl');
    // Use pre-configured token if available
    this.accessToken = config.get<string>('flipkart.accessToken') || null;
  }

  // ─── Authentication (OAuth2 Client Credentials) ───────────────────────────

  async authenticate(): Promise<ConnectorResult<boolean>> {
    try {
      const credentials = Buffer.from(`${this.appId}:${this.appSecret}`).toString('base64');
      const response = await this.http.get(
        `${this.tokenUrl}?grant_type=client_credentials&scope=Seller_Api`,
        {
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      this.accessToken = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      this.logger.log('Flipkart OAuth2 authentication successful');
      return this.success(true);
    } catch (error) {
      return this.failure(error);
    }
  }

  private get apiHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken || this.config.get<string>('flipkart.accessToken')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  // ─── Health Check ─────────────────────────────────────────────────────────

  async healthCheck(): Promise<ConnectorResult<{ status: string; latencyMs: number }>> {
    try {
      await this.ensureAuthenticated();
      const { durationMs } = await this.measureTime(() =>
        this.http.get(`${this.apiUrl}/v3/listings`, {
          headers: this.apiHeaders,
          params: { page_size: 1 },
        }),
      );
      return this.success({ status: 'healthy', latencyMs: durationMs });
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Fetch Orders ─────────────────────────────────────────────────────────

  async fetchOrders(
    params?: FetchOrdersParams,
  ): Promise<ConnectorResult<PaginatedResult<NormalizedOrder>>> {
    try {
      await this.ensureAuthenticated();

      const queryParams: Record<string, any> = {
        state: params?.status || 'APPROVED',
        page_size: params?.pageSize || 100,
      };

      if (params?.fromDate) queryParams.after = params.fromDate.toISOString();
      if (params?.nextToken) queryParams.page_token = params.nextToken;

      const response = await this.withRetry(() =>
        this.http.get(`${this.apiUrl}/v3/orders`, {
          headers: this.apiHeaders,
          params: queryParams,
        }),
      );

      const orders = response.data?.order_items || [];
      const normalized: NormalizedOrder[] = orders.map((order: any) =>
        this.normalizeOrder(order),
      );

      return this.success({
        items: normalized,
        total: response.data?.total_items || normalized.length,
        page: response.data?.current_page || 1,
        pageSize: params?.pageSize || 100,
        hasMore: !!response.data?.next_page_url,
        nextToken: response.data?.next_page_token,
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Fetch Products ───────────────────────────────────────────────────────

  async fetchProducts(
    params?: FetchProductsParams,
  ): Promise<ConnectorResult<PaginatedResult<NormalizedProduct>>> {
    try {
      await this.ensureAuthenticated();
      const response = await this.http.get(`${this.apiUrl}/v3/listings`, {
        headers: this.apiHeaders,
        params: {
          page_size: params?.pageSize || 100,
          page_token: params?.nextToken,
        },
      });

      const items: NormalizedProduct[] = (response.data?.listings || []).map((item: any) => ({
        sku: item.sku_id,
        flipkartSku: item.sku_id,
        name: item.product_title || item.title,
        description: item.description,
        category: item.category,
        brand: item.brand,
        mrp: parseFloat(item.mrp?.amount || '0'),
        sellingPrice: parseFloat(item.your_selling_price?.amount || '0'),
        rawPayload: item,
      }));

      return this.success({
        items,
        total: response.data?.total_items || items.length,
        page: 1,
        pageSize: params?.pageSize || 100,
        hasMore: !!response.data?.next_page_token,
        nextToken: response.data?.next_page_token,
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Create Listing ───────────────────────────────────────────────────────

  async createListing(product: NormalizedProduct, isDraft: boolean): Promise<ConnectorResult<boolean>> {
    try {
      await this.ensureAuthenticated();
      
      const payload = {
        sku_id: product.sku,
        product_id: product.flipkartSku || product.sku,
        listing_status: isDraft ? 'INACTIVE' : 'ACTIVE',
        mrp: { amount: product.mrp || 0, unit: 'INR' },
        your_selling_price: { amount: product.sellingPrice || product.mrp || 0, unit: 'INR' },
        tax_rule_id: 'Standard',
        fulfillment_profile: 'SELLER_FULFILLMENT',
        shipping_provider: 'FLIPKART',
      };

      await this.http.post(
        `${this.apiUrl}/v3/listings`,
        { listings: [payload] },
        { headers: this.apiHeaders }
      );

      return this.success(true);
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Update Inventory ─────────────────────────────────────────────────────

  async updateInventory(items: NormalizedInventory[]): Promise<ConnectorResult<UpdateResult>> {
    try {
      await this.ensureAuthenticated();
      const result: UpdateResult = { total: items.length, success: 0, failed: 0, errors: [] };

      const batches = this.chunk(items, 20);
      for (const batch of batches) {
        try {
          await this.http.post(
            `${this.apiUrl}/v3/listings/inventory`,
            {
              inventory: batch.map((item) => ({
                sku_id: item.sku,
                available_qty: item.availableQty,
              })),
            },
            { headers: this.apiHeaders },
          );
          result.success += batch.length;
        } catch (err) {
          result.failed += batch.length;
          batch.forEach((item) => result.errors.push({ sku: item.sku, error: err.message }));
        }
      }

      return this.success(result);
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Update Price ─────────────────────────────────────────────────────────

  async updatePrice(items: NormalizedPrice[]): Promise<ConnectorResult<UpdateResult>> {
    try {
      await this.ensureAuthenticated();
      const result: UpdateResult = { total: items.length, success: 0, failed: 0, errors: [] };

      const batches = this.chunk(items, 20);
      for (const batch of batches) {
        try {
          await this.http.post(
            `${this.apiUrl}/v3/listings/price`,
            {
              prices: batch.map((item) => ({
                sku_id: item.sku,
                mrp: { amount: item.mrp, unit: 'INR' },
                your_selling_price: { amount: item.sellingPrice, unit: 'INR' },
              })),
            },
            { headers: this.apiHeaders },
          );
          result.success += batch.length;
        } catch (err) {
          result.failed += batch.length;
          batch.forEach((item) => result.errors.push({ sku: item.sku, error: err.message }));
        }
      }

      return this.success(result);
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Create Shipment ──────────────────────────────────────────────────────

  async createShipment(shipment: NormalizedShipment): Promise<ConnectorResult<{ shipmentId: string }>> {
    try {
      await this.ensureAuthenticated();
      const response = await this.http.post(
        `${this.apiUrl}/v3/orders/dispatch`,
        {
          order_id: shipment.marketplaceOrderId,
          shipment_provider: shipment.carrier,
          tracking_id: shipment.trackingNumber,
          is_self_ship: false,
        },
        { headers: this.apiHeaders },
      );
      return this.success({ shipmentId: response.data?.shipment_id || shipment.trackingNumber });
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Cancel Order ─────────────────────────────────────────────────────────

  async cancelOrder(orderId: string, reason?: string): Promise<ConnectorResult<boolean>> {
    try {
      await this.ensureAuthenticated();
      await this.http.post(
        `${this.apiUrl}/v3/orders/${orderId}/cancel`,
        { cancellation_reason: reason || 'Seller initiated' },
        { headers: this.apiHeaders },
      );
      return this.success(true);
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Order Normalization ──────────────────────────────────────────────────

  private normalizeOrder(raw: any): NormalizedOrder {
    const addr = raw.shipping_address || {};

    const shippingAddress: NormalizedAddress = {
      name: raw.buyer?.name || addr.name || '',
      line1: addr.address_line1 || addr.house_number || '',
      line2: addr.address_line2 || addr.building_name,
      city: addr.city || '',
      state: addr.state || '',
      country: 'IN',
      pincode: addr.pincode || '',
      phone: raw.buyer?.phone_number || addr.contact_number,
    };

    const item: NormalizedOrderItem = {
      sku: raw.sku_id || raw.listing_id,
      marketplaceSku: raw.sku_id,
      marketplaceItemId: raw.order_item_id,
      productName: raw.product_title || '',
      quantity: raw.quantity || 1,
      unitPrice: parseFloat(raw.selling_price?.amount || '0'),
      tax: parseFloat(raw.tax_amount?.amount || '0'),
      total: parseFloat(raw.total_price?.amount || '0'),
      itemStatus: raw.state,
      rawPayload: raw,
    };

    return {
      marketplaceOrderId: raw.order_id || raw.order_item_id,
      source: MarketplaceSource.FLIPKART,
      customerName: raw.buyer?.name || 'Flipkart Buyer',
      customerEmail: raw.buyer?.email,
      customerPhone: raw.buyer?.phone_number,
      shippingAddress,
      items: [item],
      subtotal: parseFloat(raw.selling_price?.amount || '0'),
      tax: parseFloat(raw.tax_amount?.amount || '0'),
      total: parseFloat(raw.total_price?.amount || '0'),
      currency: raw.total_price?.unit || 'INR',
      orderDate: raw.order_date ? new Date(raw.order_date) : new Date(),
      promisedDeliveryDate: raw.dispatch_by_date ? new Date(raw.dispatch_by_date) : undefined,
      rawPayload: raw,
    };
  }
}
