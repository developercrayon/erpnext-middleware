import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientService } from '../../../shared/http-client.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FieldMapping } from '../../../database/entities/mapping.entity';
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
    @InjectRepository(FieldMapping)
    private readonly mappingRepo: Repository<FieldMapping>,
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

      let queryParams: Record<string, any> = {};

      if (params?.nextToken) {
        queryParams.NextToken = params.nextToken;
      } else {
        queryParams.MarketplaceIds = this.marketplaceId;
        if (params?.status) {
          queryParams.OrderStatuses = params.status;
        }
        queryParams.MaxResultsPerPage = params?.pageSize || 100;
        
        if (params?.fromDate) {
          queryParams.CreatedAfter = params.fromDate.toISOString().split('.')[0] + 'Z';
        } else {
          queryParams.CreatedAfter = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('.')[0] + 'Z';
        }
      }

      const response = await this.withRetry(() =>
        this.http.get(`${this.endpoint}/orders/v0/orders`, {
          headers: this.spApiHeaders,
          params: queryParams,
        }),
      );

      const ordersData = response.data?.payload?.Orders || [];
      const nextToken = response.data?.payload?.NextToken;

      const normalizedOrders: NormalizedOrder[] = [];
      for (const order of ordersData) {
        normalizedOrders.push(await this.normalizeOrder(order));
      }

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

  // ─── Fetch Product Types ───────────────────────────────────────────────────────
  
  async fetchProductTypes(): Promise<ConnectorResult<string[]>> {
    try {
      await this.ensureAuthenticated();
      const prodEndpoint = this.endpoint.replace('sandbox.', '');
      const response = await this.http.get(
        `${prodEndpoint}/definitions/2020-09-01/productTypes`,
        {
          headers: this.spApiHeaders,
          params: { marketplaceIds: this.marketplaceId },
        },
      );
      
      const productTypes = response.data?.productTypes?.map((pt: any) => pt.name) || [];
      return this.success(productTypes);
    } catch (error) {
      return this.failure(error);
    }
  }

  // ─── Fetch Product Fields ──────────────────────────────────────────────────────

  async fetchProductFields(productType: string): Promise<ConnectorResult<any>> {
    try {
      await this.ensureAuthenticated();
      const prodEndpoint = this.endpoint.replace('sandbox.', '');
      const response = await this.http.get(
        `${prodEndpoint}/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}`,
        {
          headers: this.spApiHeaders,
          params: {
            marketplaceIds: this.marketplaceId,
            requirements: 'LISTING',
          },
        },
      );
      const definition = response.data;
      
      // Amazon SP-API returns a link to download the actual JSON Schema
      if (definition?.schema?.link?.resource) {
        const schemaResponse = await require('axios').default.get(definition.schema.link.resource);
        definition.schema = schemaResponse.data;
      }
      
      return this.success(definition);
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

      // Check if product already exists on Amazon
      let existingAsin = null;
      try {
        existingAsin = await this.getListingAsin(product.sku);
      } catch (e) {
        this.logger.debug(`Could not check existing ASIN for ${product.sku}`);
      }
      
      const isUpdate = !!existingAsin;

      console.log(`[DEBUG] amazonConnector.createListing called for SKU: ${product.sku}. amazonProductType:`, product.amazonProductType, 'attributes:', product.attributes?.amazonProductType);

      // Determine product type. Amazon requires specific types (e.g. MUG, SHIRT) to create new products.
      let productType = product.amazonProductType || product.attributes?.amazonProductType;

      // Map invalid ERPNext product types to valid Amazon SP-API product types
      const productTypeMap: Record<string, string> = {
        'HOME_FURNITURE_AND_DECOR': 'SHELF',
      };

      if (productType && productTypeMap[productType]) {
        productType = productTypeMap[productType];
      }

      if (!productType) {
        if (!isUpdate) {
          return this.failure("Amazon Product Type is required to create new products on Amazon. The generic 'PRODUCT' type is not allowed for new listings.");
        }
        productType = 'PRODUCT'; // Only fallback to generic PRODUCT for updating existing offers
      }

      const requirements = productType === 'PRODUCT' ? 'LISTING_OFFER_ONLY' : 'LISTING';

      const payload: any = {
        productType,
        requirements,
        attributes: {
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

      // Only set to draft if it's a new listing
      if (!isUpdate) {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);

        payload.attributes.merchant_suggested_asin = [{ value: 'DRAFT' }];
        payload.attributes.purchasable_at = [{ value: futureDate.toISOString() }];
      }

      if (!product.isParent) {
        const availableQty = product.rawPayload?.availableQty || 0;
        payload.attributes.purchasable_offer = [{
          currency: 'INR',
          our_price: [{
            schedule: [{
              value_with_tax: product.sellingPrice
            }]
          }]
        }];
        payload.attributes.fulfillment_availability = [{
          fulfillment_channel_code: 'DEFAULT',
          quantity: availableQty
        }];
      }

      // Dimensions and Weight
      const erp = product.attributes || {};
      const raw = product.attributes || {};
      
      const dVal = raw.customDepth || product.customDepth;
      const wVal = raw.customWidth || product.customWidth;
      const hVal = raw.customHeight || product.customHeight;
      const depth = dVal ? parseFloat(dVal) : null;
      const width = wVal ? parseFloat(wVal) : null;
      const height = hVal ? parseFloat(hVal) : null;

      let dimUnit = 'centimeters';
      const rawUnit = raw.customUnit || product.customUnit;
      if (rawUnit) {
        const u = rawUnit.toString().toLowerCase().trim();
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
      const weightVal = raw.weight || product.weight || erp.weight_per_unit;
      if (weightVal !== undefined && weightVal !== null && weightVal !== '') {
        payload.attributes.item_weight = [{ value: parseFloat(weightVal), unit: 'kilograms' }];
      }

      // --- DYNAMIC FIELD MAPPING ---
      try {
        const mappings = await this.mappingRepo.find({ 
          where: { 
            marketplace: MarketplaceSource.AMAZON,
            productType: productType
          } 
        });
        const erp = product.attributes || {};
        const raw = product.attributes || {};
        
        for (const mapping of mappings) {
          // Attempt to get value from ERPNext payload
          let val = erp[mapping.erpnextField];
          if (val === undefined || val === null) {
            val = raw[mapping.erpnextField];
          }
          if (val === undefined || val === null) {
            val = product[mapping.erpnextField as keyof NormalizedProduct];
          }

          // Apply fallback/default value if configured
          if ((val === undefined || val === null || val === '') && mapping.useDefault) {
            val = mapping.defaultValue;
          }

          if (val !== undefined && val !== null && val !== '') {
             if (mapping.dataType === 'CHILD_TABLE' || mapping.dataType === 'CHILD_TABLE_ARRAY') {
                if (Array.isArray(val) && val.length > 0) {
                  // For child tables, try to extract 'title' or 'bullet_point' or 'title_key' if it's an object array
                  const mappedArray = val.map(v => {
                    if (typeof v === 'object') {
                      return { value: (v.title || v.title_key || v.bullet_point || v.special_feature || Object.values(v)[0] || '').toString(), language_tag: 'en_IN' };
                    }
                    return { value: v.toString(), language_tag: 'en_IN' };
                  });
                  if (mappedArray.length > 0) {
                     payload.attributes[mapping.marketplaceField] = mappedArray;
                  }
                } else if (typeof val === 'string') {
                  // Comma separated? Or just single value
                   payload.attributes[mapping.marketplaceField] = [{ value: val.toString(), language_tag: 'en_IN' }];
                }
             } else {
               // Special handling for Amazon's strict schemas
               const field = mapping.marketplaceField;

               if (Array.isArray(val) && val.length > 0) {
                 const mappedArray = val.map(v => {
                   if (typeof v === 'object') {
                     return { value: (v.title || v.title_key || v.bullet_point || v.special_feature || Object.values(v)[0] || '').toString(), language_tag: 'en_IN' };
                   }
                   return { value: v.toString(), language_tag: 'en_IN' };
                 });
                 if (mappedArray.length > 0) {
                    payload.attributes[field] = mappedArray;
                 }
               } else if (field === 'main_product_image_locator' || field.includes('other_product_image_locator')) {
                 let mediaUrl = val.toString();
                 if (mediaUrl.startsWith('/')) {
                   const defaultBaseUrl = process.env.ERPNEXT_BASE_URL || 'https://woodwolf.t3elements.com';
                   if (product.thumbnailUrl && product.thumbnailUrl.startsWith('http')) {
                     try {
                       const url = new URL(product.thumbnailUrl);
                       mediaUrl = url.origin + mediaUrl;
                     } catch(e) {
                       mediaUrl = defaultBaseUrl.replace(/\/$/, '') + mediaUrl;
                     }
                   } else {
                     mediaUrl = defaultBaseUrl.replace(/\/$/, '') + mediaUrl;
                   }
                 }
                 payload.attributes[field] = [{ marketplace_id: this.marketplaceId, media_location: mediaUrl }];
               } else if (field === 'country_of_origin') {
                 let code = val.toString();
                 if (code.toLowerCase() === 'india') code = 'IN';
                 else if (code.toLowerCase() === 'united states' || code.toLowerCase() === 'usa') code = 'US';
                 else if (code.toLowerCase() === 'china') code = 'CN';
                 payload.attributes[field] = [{ value: code, language_tag: 'en_IN' }];
               } else if (field === 'shelf_thickness') {
                 payload.attributes[field] = [{ value: parseFloat(val.toString()) || 0, unit: 'centimeters', language_tag: 'en_IN' }];
               } else if (field === 'external_product_information') {
                 payload.attributes[field] = [{ value: val.toString(), entity: val.toString(), language_tag: 'en_IN' }];
               } else if (field === 'supplier_declared_dg_hz_regulation') {
                 let dgVal = val.toString();
                 if (dgVal.toLowerCase() === 'false' || dgVal.toLowerCase() === 'no') {
                   dgVal = 'not_applicable';
                 }
                 payload.attributes[field] = [{ value: dgVal, language_tag: 'en_IN' }];
               } else if (field === 'purchasable_at') {
                 // Ignore purchasable_at as Amazon warns it's not applicable for this product type
                 continue;
               } else {
                 // Standard string/number/boolean mapping
                 payload.attributes[field] = [{ value: val.toString(), language_tag: 'en_IN' }];
               }
             }
          }
        }
      } catch (err) {
        this.logger.error(`Failed to apply dynamic mappings: ${err.message}`);
      }
      // --- END DYNAMIC FIELD MAPPING ---

      if (!payload.attributes.supplier_declared_dg_hz_regulation) {
        payload.attributes.supplier_declared_dg_hz_regulation = [{ value: "not_applicable", language_tag: "en_IN" }];
      }
      if (!payload.attributes.batteries_required) {
        payload.attributes.batteries_required = [{ value: false }];
      }

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

      this.logger.debug(`PUT Listings attributes for ${product.sku}: ` + JSON.stringify(payload.attributes, null, 2));

      console.log(payload)

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

      if (issues.length > 0) {
        this.logger.warn(`Amazon Sync Issues for ${product.sku}: ` + JSON.stringify(issues));
      }

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
      const response = await this.withRetry(() =>
        this.http.get(`${this.endpoint}/orders/v0/orders/${orderId}/orderItems`, {
          headers: this.spApiHeaders,
        })
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
