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
        dataElements: 'buyerInfo,shippingAddress',
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
      let productType = product.amazonProductType || product.attributes?.amazonProductType || 'PRODUCT';
      
      // Map invalid ERPNext product types to valid Amazon SP-API product types
      const productTypeMap: Record<string, string> = {
        'HOME_FURNITURE_AND_DECOR': 'SHELF',
      };
      
      if (productTypeMap[productType]) {
        productType = productTypeMap[productType];
      }

      const requirements = productType === 'PRODUCT' ? 'LISTING_OFFER_ONLY' : 'LISTING';

      const payload: any = {
        productType,
        requirements,
        attributes: {
          condition_type: [{ value: 'new_new' }],
          item_name: [{ value: product.name, language_tag: 'en_IN' }],
        },
      };

      if (product.isParent) {
        payload.attributes.parentage_level = [{ value: 'parent' }];
        payload.attributes.variation_theme = [{ name: product.variationTheme || 'COLOR' }];
      } else if (product.variantOf) {
        payload.attributes.parentage_level = [{ value: 'child' }];
        payload.attributes.child_parent_sku_relationship = [{
          parent_sku: product.variantOf,
          relationship_type: 'variation',
          variation_theme: { name: product.variationTheme || 'COLOR' }
        }];
      }

      if (product.brand) {
        payload.attributes.brand = [{ value: product.brand, language_tag: 'en_IN' }];
      }
      
      if (product.description) {
        // Amazon expects plain text. Strip HTML tags from rich text editor output.
        const plainTextDescription = product.description
          .replace(/<br\s*[\/]?>/gi, '\n') // Replace <br> with newlines
          .replace(/<\/p>/gi, '\n\n') // Replace </p> with double newlines
          .replace(/<[^>]+>/g, '') // Strip remaining HTML tags
          .replace(/&nbsp;/g, ' ') // Decode common entities
          .replace(/&amp;/g, '&')
          .trim();
        payload.attributes.product_description = [{ value: plainTextDescription, language_tag: 'en_IN' }];
      }

      const bulletPoints = product.customAmazonBulletPoint || product.rawPayload?.customAmazonBulletPoint;
      if (bulletPoints && Array.isArray(bulletPoints) && bulletPoints.length > 0) {
        payload.attributes.bullet_point = bulletPoints
          .filter(bp => bp && bp.bullet_point)
          .map(bp => ({ value: bp.bullet_point, language_tag: 'en_IN' }));
      }
      
      const mainImage = product.thumbnailUrl || (product.images && product.images.length > 0 ? product.images[0] : null);
      const allImages = product.images && product.images.length > 0 ? product.images : (mainImage ? [mainImage] : []);
      const otherImages = allImages.filter(img => img !== mainImage);

      if (mainImage) {
        if (requirements === 'LISTING') {
          // Full listing: use product image locators (these appear in the product detail page)
          payload.attributes.main_product_image_locator = [{
            marketplace_id: this.marketplaceId,
            media_location: mainImage
          }];
          // Additional images for product detail page
          for (let i = 0; i < Math.min(otherImages.length, 8); i++) {
            payload.attributes[`other_product_image_locator_${i + 1}`] = [{
              marketplace_id: this.marketplaceId,
              media_location: otherImages[i]
            }];
          }
        }
        // Both LISTING and LISTING_OFFER_ONLY: use offer image locators (these appear in the cart/list)
        payload.attributes.main_offer_image_locator = [{
          marketplace_id: this.marketplaceId,
          media_location: mainImage
        }];
        for (let i = 0; i < Math.min(otherImages.length, 5); i++) {
          payload.attributes[`other_offer_image_locator_${i + 1}`] = [{
            marketplace_id: this.marketplaceId,
            media_location: otherImages[i]
          }];
        }
      }

      if (!product.isParent) {
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
      }

      // To create a "Draft/Inactive" listing on Amazon, we set purchasable to false
      // or omit inventory details entirely. We do not send purchasable_offer
      // via putListingsItem. Price and Inventory are updated via their respective feeds.

      if (requirements === 'LISTING') {
      if (requirements === 'LISTING') {
        const erp = product.attributes || {};
        const raw = product.rawPayload || {};
        
        // Helper function for text attributes
        const setStringValue = (amazonField: string, erpVal: any, language_tag?: string) => {
          if (erpVal) {
            payload.attributes[amazonField] = language_tag 
              ? [{ value: erpVal.toString(), language_tag }]
              : [{ value: erpVal.toString() }];
          }
        };

        // Helper function for child tables
        const setChildTable = (amazonField: string, erpArray: any[], fieldName: string, language_tag?: string) => {
          if (erpArray && Array.isArray(erpArray) && erpArray.length > 0) {
            const mapped = erpArray.map(item => {
               if (item[fieldName]) {
                 return language_tag 
                   ? { value: item[fieldName].toString(), language_tag }
                   : { value: item[fieldName].toString() };
               }
               return null;
            }).filter(i => i !== null);
            if (mapped.length > 0) {
              payload.attributes[amazonField] = mapped;
            }
          }
        };

        // Country of Origin
        let country = erp.country_of_origin;
        if (country && country.toLowerCase() === 'india') country = 'IN';
        setStringValue('country_of_origin', country);

        // Core fields
        setStringValue('item_type_name', erp.custom_item_type_name, 'en_IN');
        setStringValue('model_name', erp.custom_model_name);
        setStringValue('manufacturer', erp.default_item_manufacturer || product.brand);
        setStringValue('model_number', raw.custom_model_number || product.sku);
        setStringValue('style', raw.custom_style);
        
        if (raw.custom_number_of_items) {
           payload.attributes.number_of_items = [{ value: parseInt(raw.custom_number_of_items, 10) }];
        }
        if (raw.custom_number_of_pieces) {
           payload.attributes.number_of_pieces = [{ value: parseInt(raw.custom_number_of_pieces, 10) }];
        }
        
        setStringValue('item_shape', raw.custom_item_shape);
        setStringValue('rtip_manufacturer_contact_information', raw.custom__manufacturer_contact_information);
        
        if (raw.custom_required_assembly !== undefined && raw.custom_required_assembly !== null && raw.custom_required_assembly !== '') {
           payload.attributes.assembly_required = [{ value: Boolean(raw.custom_required_assembly) }];
        }
        
        setStringValue('shelf_type', raw.custom__shelf_type);
        if (raw.custom_number_of_shelves) {
           payload.attributes.number_of_shelves = [{ value: parseInt(raw.custom_number_of_shelves, 10) }];
        }
        setStringValue('assembly_instructions', raw.custom_assembly_instructions, 'en_IN');
        setStringValue('mounting_type', raw.custom_mounting_type, 'en_IN');
        setStringValue('finish_type', raw.custom_finish_type, 'en_IN');
        
        if (raw.custom__external_product_information || erp.gst_hsn_code) {
           payload.attributes.external_product_information = [{
             entity: 'HSN Code',
             value: raw.custom__external_product_information || erp.gst_hsn_code
           }];
        }

        if (raw.custom_number_of_packs) {
           payload.attributes.unit_count = [{ value: parseFloat(raw.custom_number_of_packs), type: { value: 'count', language_tag: 'en_IN' } }];
        }

        if (raw.custom_shelf_thickness) {
           payload.attributes.shelf_thickness = [{ value: parseFloat(raw.custom_shelf_thickness), unit: 'centimeters' }];
        }

        // Child Tables
        setChildTable('bullet_point', raw.custom_amazon_bullet_point, 'bullet_point', 'en_IN');
        setChildTable('special_feature', raw.custom_special_feature, 'special_feature', 'en_IN');
        setChildTable('material', raw.custom_select_material, 'material', 'en_IN');
        setChildTable('care_instructions', raw.custom_care_instructions, 'care_instruction', 'en_IN');
        setChildTable('included_components', raw.custom_included_components, 'included_components', 'en_IN');
        setChildTable('specific_uses_for_product', raw.custom_specific_uses_for_product, 'title_key', 'en_IN');
        setChildTable('recommended_uses_for_product', raw.custom_recommended_uses_for_product, 'title', 'en_IN');
        setChildTable('room_type', raw.custom_room_type, 'room_type', 'en_IN');
        setChildTable('packer_contact_information', raw.custom_packer_contact_information, 'title_key', 'en_IN');

        // Color & Size (from variant attributes + custom fields)
        let colorVal = raw.custom_color || null;
        let sizeVal = null;
        
        if (product.variantAttributes) {
          const colorAttr = product.variantAttributes.find(a => a.name.toLowerCase() === 'colour' || a.name.toLowerCase() === 'color');
          if (colorAttr && !colorVal) colorVal = colorAttr.value;
          
          const sizeAttr = product.variantAttributes.find(a => a.name.toLowerCase() === 'size');
          if (sizeAttr) sizeVal = sizeAttr.value;
        }

        if (!product.isParent) {
          if (colorVal) {
            payload.attributes.color = [{ 
              value: colorVal, 
              language_tag: 'en_IN',
              standardized_values: [colorVal.toLowerCase()] 
            }];
          }
          if (sizeVal) {
            payload.attributes.size = [{ 
              value: sizeVal, 
              language_tag: 'en_IN' 
            }];
          }
        }
        
        // Minimum required fields for safety
        payload.attributes.batteries_required = [{ value: false }];
        payload.attributes.supplier_declared_dg_hz_regulation = [{ value: 'not_applicable' }];
        
        // Dimensions
        const depth = raw.custom_depth ? parseFloat(raw.custom_depth) : null;
        const width = raw.custom_width ? parseFloat(raw.custom_width) : null;
        const height = raw.custom_height ? parseFloat(raw.custom_height) : null;
        
        let dimUnit = 'centimeters';
        if (raw.custom_unit) {
          const u = raw.custom_unit.toString().toLowerCase().trim();
          if (u === 'cm' || u === 'centimeter' || u === 'centimeters') dimUnit = 'centimeters';
          else if (u === 'inch' || u === 'in' || u === 'inches') dimUnit = 'inches';
          else if (u === 'mm' || u === 'millimeter' || u === 'millimeters') dimUnit = 'millimeters';
          else if (u === 'm' || u === 'meter' || u === 'meters') dimUnit = 'meters';
          else if (u === 'ft' || u === 'foot' || u === 'feet') dimUnit = 'feet';
        }
        
        if (depth !== null && width !== null && height !== null) {
          payload.attributes.item_dimensions = [{
            height: { value: height, unit: dimUnit },
            length: { value: depth, unit: dimUnit },
            width: { value: width, unit: dimUnit }
          }];
        }
        if (width !== null && height !== null) {
          payload.attributes.item_width_height = [{
            height: { value: height, unit: dimUnit },
            width: { value: width, unit: dimUnit }
          }];
        }
        
        // Weight
        if (erp.weight_per_unit) {
          payload.attributes.item_weight = [{ value: parseFloat(erp.weight_per_unit), unit: 'kilograms' }];
        }
      }
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
        `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(product.sku)}`,
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
            const res = await this.http.patch(
              `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(item.sku)}`,
              {
                productType: 'PRODUCT',
                patches: [
                  {
                    op: 'replace',
                    path: '/attributes/fulfillment_availability',
                    value: [
                      {
                        fulfillment_channel_code: 'DEFAULT',
                        quantity: item.availableQty
                      }
                    ]
                  }
                ]
              },
              {
                headers: this.spApiHeaders,
                params: { marketplaceIds: this.marketplaceId, issueLocale: 'en_IN' }
              },
            );

            const issues = res.data?.issues || [];
            this.logger.debug(`Amazon PATCH response for ${item.sku}: ` + JSON.stringify(res.data));
            
            const errors = issues.filter((i: any) => i.severity === 'ERROR');
            
            if (errors.length > 0) {
              result.failed++;
              result.errors.push({ sku: item.sku, error: errors.map((e: any) => e.message).join(' | ') });
            } else {
              result.success++;
            }
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
          const res = await this.http.patch(
            `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(item.sku)}`,
            {
              productType: 'PRODUCT',
              patches: [
                {
                  op: 'replace',
                  path: '/attributes/purchasable_offer',
                  value: [
                    {
                      currency: 'INR',
                      our_price: [
                        {
                          schedule: [
                            {
                              value_with_tax: item.sellingPrice
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              headers: this.spApiHeaders,
              params: { marketplaceIds: this.marketplaceId, issueLocale: 'en_IN' }
            },
          );

          const issues = res.data?.issues || [];
          this.logger.debug(`Amazon PATCH response for price ${item.sku}: ` + JSON.stringify(res.data));
          
          const errors = issues.filter((i: any) => i.severity === 'ERROR');
          
          if (errors.length > 0) {
            result.failed++;
            result.errors.push({ sku: item.sku, error: errors.map((e: any) => e.message).join(' | ') });
          } else {
            result.success++;
          }
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
