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
export class AmazonConnector extends BaseConnector {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;
  private readonly marketplaceId: string;
  private readonly sellerId: string;
  private readonly endpoint: string;
  private readonly lwaEndpoint = 'https://api.amazon.com/auth/o2/token';

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpClientService,
  ) {
    super('AmazonConnector');
    this.clientId = config.get<string>('amazon.clientId');
    this.clientSecret = config.get<string>('amazon.clientSecret');
    this.refreshToken = config.get<string>('amazon.refreshToken');
    this.marketplaceId = config.get<string>('amazon.marketplaceId');
    this.sellerId = config.get<string>('amazon.sellerId');
    this.endpoint = config.get<string>('amazon.endpoint');
  }

  // ─── Authentication (LWA) ─────────────────────────────────────────────────

  async authenticate(): Promise<ConnectorResult<boolean>> {
    try {
      const response = await this.http.post(
        this.lwaEndpoint,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      this.accessToken = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;
      this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      this.logger.log('Amazon LWA authentication successful');
      return this.success(true);
    } catch (error) {
      return this.failure(error);
    }
  }

  private get spApiHeaders(): Record<string, string> {
    return {
      'x-amz-access-token': this.accessToken || '',
      'Content-Type': 'application/json',
    };
  }

  // ─── Health Check ─────────────────────────────────────────────────────────

  async healthCheck(): Promise<ConnectorResult<{ status: string; latencyMs: number }>> {
    try {
      await this.ensureAuthenticated();
      const { durationMs } = await this.measureTime(() =>
        this.http.get(
          `${this.endpoint}/sellers/v1/marketplaceParticipations`,
          { headers: this.spApiHeaders },
        ),
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
        MarketplaceIds: this.marketplaceId,
        OrderStatuses: params?.status || 'Unshipped,PartiallyShipped',
        MaxResultsPerPage: params?.pageSize || 100,
      };

      if (params?.fromDate) {
        queryParams.CreatedAfter = params.fromDate.toISOString();
      }
      if (params?.nextToken) {
        queryParams.NextToken = params.nextToken;
      }

      const response = await this.withRetry(() =>
        this.http.get(`${this.endpoint}/orders/v0/orders`, {
          headers: this.spApiHeaders,
          params: queryParams,
        }),
      );

      const ordersData = response.data?.payload?.Orders || [];
      const nextToken = response.data?.payload?.NextToken;

      const normalizedOrders: NormalizedOrder[] = await Promise.all(
        ordersData.map((order: any) => this.normalizeOrder(order)),
      );

      return this.success({
        items: normalizedOrders,
        total: normalizedOrders.length,
        page: 1,
        pageSize: params?.pageSize || 100,
        hasMore: !!nextToken,
        nextToken,
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
      const response = await this.http.get(
        `${this.endpoint}/catalog/2022-04-01/items`,
        {
          headers: this.spApiHeaders,
          params: {
            marketplaceIds: this.marketplaceId,
            pageSize: params?.pageSize || 20,
            pageToken: params?.nextToken,
          },
        },
      );

      const items = (response.data?.items || []).map((item: any) => ({
        sku: item.asin,
        name: item.summaries?.[0]?.itemName || item.asin,
        description: item.summaries?.[0]?.itemDescription,
        category: item.summaries?.[0]?.itemClassification,
        mrp: 0,
        sellingPrice: 0,
        rawPayload: item,
      }));

      return this.success({
        items,
        total: items.length,
        page: 1,
        pageSize: params?.pageSize || 20,
        hasMore: !!response.data?.nextPageToken,
        nextToken: response.data?.nextPageToken,
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Create Listing ───────────────────────────────────────────────────────

  async createListing(product: NormalizedProduct, isDraft: boolean): Promise<ConnectorResult<boolean>> {
    try {
      await this.ensureAuthenticated();
      
      // Determine product type. Amazon requires specific types (e.g. MUG, SHIRT) to create new products.
      const productType = product.amazonProductType || product.attributes?.amazonProductType || 'PRODUCT';
      const requirements = productType === 'PRODUCT' ? 'LISTING_OFFER_ONLY' : 'LISTING';

      const payload: any = {
        productType,
        requirements,
        attributes: {
          condition_type: [{ value: 'new_new' }],
          item_name: [{ value: product.name, language_tag: 'en_IN' }],
        },
      };

      if (product.brand) {
        payload.attributes.brand = [{ value: product.brand, language_tag: 'en_IN' }];
      }
      
      if (product.description) {
        // Amazon expects plain text; strip HTML tags that come from ERPNext
        const plainDesc = product.description.replace(/<[^>]*>?/gm, '').trim();
        if (plainDesc) {
          payload.attributes.product_description = [{ value: plainDesc, language_tag: 'en_IN' }];
        }
      }
      
      const mainImage = product.thumbnailUrl || (product.images && product.images.length > 0 ? product.images[0] : null);
      if (mainImage) {
        payload.attributes.main_product_image_locator = [{ 
          marketplace_id: this.marketplaceId,
          media_location: mainImage 
        }];
      }

      // If there are additional images, add them to other_product_image_locator_N
      if (product.images && product.images.length > 0) {
        const otherImages = product.images.filter(img => img !== mainImage);
        for (let i = 0; i < Math.min(otherImages.length, 8); i++) {
          const key = `other_product_image_locator_${i + 1}`;
          payload.attributes[key] = [{
            marketplace_id: this.marketplaceId,
            media_location: otherImages[i]
          }];
        }
      }

      if (product.upc) {
        payload.attributes.externally_assigned_product_identifier = [{
          type: 'upc',
          value: product.upc,
        }];
      } else if (product.attributes?.ean) {
        payload.attributes.externally_assigned_product_identifier = [{
          type: 'ean',
          value: product.attributes.ean
        }];
      }

      // To create a "Draft/Inactive" listing on Amazon, we set purchasable to false
      // or omit inventory details entirely. We do not send purchasable_offer
      // via putListingsItem. Price and Inventory are updated via their respective feeds.

      if (requirements === 'LISTING') {
        const erp = product.attributes || {};
        
        // Dynamically mapped fields from ERPNext
        // Amazon expects 'IN' instead of 'India'
        let country = erp.country_of_origin;
        if (!country || country.toLowerCase() === 'india') country = 'IN';
        
        payload.attributes.country_of_origin = [{ value: country }];
        payload.attributes.material = [{ value: erp.custom_material || 'Ceramic', language_tag: 'en_IN' }];
        payload.attributes.item_type_name = [{ value: erp.custom_item_type_name || 'Coffee Mug', language_tag: 'en_IN' }];
        payload.attributes.model_name = [{ value: erp.custom_model_name || product.sku }];
        payload.attributes.manufacturer = [{ value: erp.default_item_manufacturer || product.brand || 'Generic' }];
        
        // Fallbacks for the remaining mandatory Amazon SP-API fields
        payload.attributes.model_number = [{ value: product.sku }];
        payload.attributes.number_of_items = [{ value: 1 }];
        payload.attributes.unit_count = [{ value: 1, type: { value: 'count', language_tag: 'en_IN' } }];
        payload.attributes.included_components = [{ value: '1 Mug', language_tag: 'en_IN' }];
        payload.attributes.bullet_point = [{ value: 'High quality product', language_tag: 'en_IN' }];
        payload.attributes.color = [{ value: 'White', language_tag: 'en_IN' }];
        payload.attributes.size = [{ value: 'Standard', language_tag: 'en_IN' }];
        payload.attributes.batteries_required = [{ value: false }];
        payload.attributes.supplier_declared_dg_hz_regulation = [{ value: 'not_applicable' }];
        payload.attributes.care_instructions = [{ value: 'Hand wash only', language_tag: 'en_IN' }];
        payload.attributes.rtip_manufacturer_contact_information = [{ value: 'contact@brand.com' }];
        payload.attributes.packer_contact_information = [{ value: 'contact@brand.com', language_tag: 'en_IN' }];
        
        payload.attributes.external_product_information = [{
          entity: 'HSN Code',
          value: erp.gst_hsn_code || '610510'
        }];

        // Units - strictly match schema formats
        payload.attributes.item_dimensions = [{
          height: { value: 10, unit: 'centimeters' },
          length: { value: 10, unit: 'centimeters' },
          width: { value: 10, unit: 'centimeters' }
        }];
        payload.attributes.item_width_height = [{
          height: { value: 10, unit: 'centimeters' },
          width: { value: 10, unit: 'centimeters' }
        }];
        payload.attributes.item_package_dimensions = [{
          height: { value: 12, unit: 'centimeters' },
          length: { value: 12, unit: 'centimeters' },
          width: { value: 12, unit: 'centimeters' }
        }];
        payload.attributes.item_weight = [{ value: 0.5, unit: 'kilograms' }];
        payload.attributes.item_package_weight = [{ value: 0.6, unit: 'kilograms' }];
        payload.attributes.capacity = [{ value: 350, unit: 'milliliters' }];
      }

      payload.attributes.condition_type = [{ value: 'new_new', marketplace_id: this.marketplaceId }];

      // If the product has an ASIN, provide it. Otherwise, Amazon might reject it for LISTING_OFFER_ONLY.
      if (product.amazonAsin) {
        payload.attributes.merchant_suggested_asin = [{ value: product.amazonAsin }];
      } else if (product.upc) {
        let idType = 'upc';
        const idLength = product.upc.trim().length;
        if (idLength === 13) idType = 'ean';
        else if (idLength === 14) idType = 'gtin';
        else if (idLength === 10) idType = 'isbn';

        payload.attributes.externally_assigned_product_identifier = [{
          type: idType,
          value: product.upc.trim()
        }];
      } else {
        payload.attributes.supplier_declared_has_product_identifier_exemption = [{ value: true }];
      }

      const response = await this.http.put(
        `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${product.sku}`,
        payload,
        {
          headers: this.spApiHeaders,
          params: { marketplaceIds: this.marketplaceId },
        },
      );

      // SP-API returns 200/202 but might contain submission issues in the body
      const data = response.data || {};
      const issues = data.issues || [];
      const errors = issues.filter((i: any) => i.severity === 'ERROR');

      if (errors.length > 0) {
        const errorMsg = errors.map((e: any) => `[${e.code}] ${e.message}`).join(' | ');
        return this.failure(`Amazon accepted submission but rejected listing with issues: ${errorMsg}`, 400);
      }

      let fetchedAsin = null;
      try {
        fetchedAsin = await this.getListingAsin(product.sku);
      } catch (err) {
        this.logger.warn(`Could not fetch ASIN immediately for SKU ${product.sku}`);
      }

      return this.success(true, { submissionId: data.submissionId, issues, asin: fetchedAsin });
    } catch (error) {
      return this.failure(error);
    }
  }

  /**
   * Fetches the Amazon ASIN for a given SKU using the Listings Items API
   */
  async getListingAsin(sku: string): Promise<string | null> {
    try {
      await this.ensureAuthenticated();
      const response = await this.http.get(
        `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(sku)}`,
        {
          headers: this.spApiHeaders,
          params: { marketplaceIds: this.marketplaceId },
        }
      );
      
      const summaries = response.data?.summaries || [];
      if (summaries.length > 0 && summaries[0].asin) {
        return summaries[0].asin;
      }
      return null;
    } catch (error) {
      // If 404, it means not found yet
      if (error.response && error.response.status === 404) {
        return null;
      }
      throw error;
    }
  }

  // ─── Update Inventory ─────────────────────────────────────────────────────

  async updateInventory(items: NormalizedInventory[]): Promise<ConnectorResult<UpdateResult>> {
    try {
      await this.ensureAuthenticated();
      // Amazon uses FBA for inventory - direct quantity updates via SP-API feeds
      const result: UpdateResult = { total: items.length, success: 0, failed: 0, errors: [] };

      const batches = this.chunk(items, 10);
      for (const batch of batches) {
        for (const item of batch) {
          try {
            await this.http.patch(
              `${this.endpoint}/fba/inventory/v1/items/${item.sku}`,
              { quantity: item.availableQty },
              { headers: this.spApiHeaders },
            );
            result.success++;
          } catch (err) {
            result.failed++;
            result.errors.push({ sku: item.sku, error: err.message });
          }
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

      for (const item of items) {
        try {
          await this.http.put(
            `${this.endpoint}/products/pricing/v0/listings/${item.sku}/offers`,
            {
              marketplaceId: this.marketplaceId,
              listingPrice: { amount: item.sellingPrice, currencyCode: 'INR' },
            },
            { headers: this.spApiHeaders },
          );
          result.success++;
        } catch (err) {
          result.failed++;
          result.errors.push({ sku: item.sku, error: err.message });
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
        `${this.endpoint}/orders/v0/orders/${shipment.marketplaceOrderId}/shipment`,
        {
          MarketplaceId: this.marketplaceId,
          ShipmentConfirmations: [{
            ShipmentTrackingNumber: shipment.trackingNumber,
            TransportDetails: {
              CarrierName: shipment.carrier,
              ShippingMethod: shipment.carrierService || 'Standard',
            },
          }],
        },
        { headers: this.spApiHeaders },
      );
      return this.success({ shipmentId: response.data?.payload?.ShipmentId || '' });
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Cancel Order ─────────────────────────────────────────────────────────

  async cancelOrder(orderId: string, reason?: string): Promise<ConnectorResult<boolean>> {
    try {
      await this.ensureAuthenticated();
      await this.http.delete(
        `${this.endpoint}/orders/v0/orders/${orderId}`,
        { headers: this.spApiHeaders, data: { cancellationReason: reason } },
      );
      return this.success(true);
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Order Normalization ──────────────────────────────────────────────────

  private async normalizeOrder(rawOrder: any): Promise<NormalizedOrder> {
    const shippingAddress = rawOrder.ShippingAddress || {};

    const address: NormalizedAddress = {
      name: shippingAddress.Name || rawOrder.BuyerInfo?.BuyerName || '',
      line1: shippingAddress.AddressLine1 || '',
      line2: shippingAddress.AddressLine2,
      city: shippingAddress.City || '',
      state: shippingAddress.StateOrRegion || '',
      country: shippingAddress.CountryCode || 'IN',
      pincode: shippingAddress.PostalCode || '',
      phone: shippingAddress.Phone,
    };

    return {
      marketplaceOrderId: rawOrder.AmazonOrderId,
      source: MarketplaceSource.AMAZON,
      customerName: rawOrder.BuyerInfo?.BuyerName || 'Amazon Buyer',
      customerEmail: rawOrder.BuyerInfo?.BuyerEmail,
      shippingAddress: address,
      items: await this.fetchOrderItems(rawOrder.AmazonOrderId),
      subtotal: parseFloat(rawOrder.OrderTotal?.Amount || '0'),
      total: parseFloat(rawOrder.OrderTotal?.Amount || '0'),
      currency: rawOrder.OrderTotal?.CurrencyCode || 'INR',
      paymentMethod: rawOrder.PaymentMethod,
      paymentStatus: rawOrder.PaymentExecutionDetail ? 'PAID' : 'PENDING',
      orderDate: new Date(rawOrder.PurchaseDate),
      promisedDeliveryDate: rawOrder.LatestDeliveryDate
        ? new Date(rawOrder.LatestDeliveryDate)
        : undefined,
      rawPayload: rawOrder,
    };
  }

  private async fetchOrderItems(orderId: string): Promise<NormalizedOrderItem[]> {
    try {
      const response = await this.http.get(
        `${this.endpoint}/orders/v0/orders/${orderId}/orderItems`,
        { headers: this.spApiHeaders },
      );

      return (response.data?.payload?.OrderItems || []).map((item: any) => ({
        sku: item.SellerSKU || item.ASIN,
        marketplaceSku: item.ASIN,
        marketplaceItemId: item.OrderItemId,
        productName: item.Title || '',
        quantity: item.QuantityOrdered,
        unitPrice: parseFloat(item.ItemPrice?.Amount || '0') / item.QuantityOrdered,
        discount: parseFloat(item.PromotionDiscount?.Amount || '0'),
        tax: parseFloat(item.ItemTax?.Amount || '0'),
        total: parseFloat(item.ItemPrice?.Amount || '0'),
        itemStatus: item.OrderItemStatus,
        rawPayload: item,
      }));
    } catch {
      return [];
    }
  }
}
