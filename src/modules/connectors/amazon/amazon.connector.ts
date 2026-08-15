import { Injectable } from '@nestjs/common';
import * as zlib from 'zlib';
import { ConfigService } from '@nestjs/config';
import { HttpClientService } from '../../../shared/http-client.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { FieldMapping } from '../../../database/entities/mapping.entity';
import { ErpnextProductField } from '../../../database/entities/erpnext-product-field.entity';
import { Unit } from '../../../database/entities/unit.entity';
import { Country } from '../../../database/entities/country.entity';
import { AmazonVariantMapping } from '../../../database/entities/amazon-variant-mapping.entity';

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
    @InjectRepository(ErpnextProductField)
    private readonly erpnextProductFieldRepo: Repository<ErpnextProductField>,
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
    @InjectRepository(Country)
    private readonly countryRepo: Repository<Country>,
    @InjectRepository(AmazonVariantMapping)
    private readonly variantMappingRepo: Repository<AmazonVariantMapping>,
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

  // ─── Fetch Single Order ───────────────────────────────────────────────────

  async fetchSingleOrder(orderId: string): Promise<ConnectorResult<any>> {
    try {
      await this.ensureAuthenticated();

      const includedDataArray = [
        'BUYER',
        'RECIPIENT',
        'PROCEEDS',
        'EXPENSE',
        'PROMOTION',
        'CANCELLATION',
        'FULFILLMENT',
        'PACKAGES',
        'TAX',
        'PAYMENT',
        'FULFILLMENT_ORDERS',
      ];

      // Build query string manually as a comma-separated string for includedData
      const queryStr = `includedData=${includedDataArray.join(',')}`;

      const response = await this.withRetry(() =>
        this.http.get(`${this.endpoint}/orders/2026-01-01/orders/${orderId}?${queryStr}`, {
          headers: this.spApiHeaders,
        }),
      );

      return this.success(response.data?.payload || response.data);
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
        definition.downloadedSchema = schemaResponse.data;
      } else {
        definition.downloadedSchema = definition?.schema;
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
            sellerId: this.sellerId,
            ...(params?.sku
              ? { identifiers: params.sku, identifiersType: params.sku.startsWith('B0') ? 'ASIN' : 'SKU' }
              : { keywords: 'woodwolf' }),
            includedData: 'attributes,dimensions,identifiers,images,productTypes,relationships,salesRanks,summaries',
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
        hasMore: !!response.data?.pagination?.nextToken,
        nextToken: response.data?.pagination?.nextToken,
      });
    } catch (error) {
      return this.failure(error);
    }
  }

  async fetchProductBySku(sku: string): Promise<ConnectorResult<NormalizedProduct>> {
    try {
      this.logger.log(`Fetching single product from Amazon for SKU: ${sku}`);
      await this.ensureAuthenticated();

      const response = await this.http.get(
        `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(sku)}`,
        {
          headers: this.spApiHeaders,
          params: {
            marketplaceIds: this.marketplaceId,
            includedData: 'attributes,issues,relationships,summaries',
          }
        }
      );
      const item = response.data;

      if (!item || !item.sku) {
        throw new Error(`SKU ${sku} not found in Seller Listings on Amazon`);
      }

      const getAmzStr = (attr: any) => {
        if (!attr || !attr.length) return '';
        return attr[0].value || '';
      };

      const summary = item.summaries && item.summaries.length > 0 ? item.summaries[0] : {};

      const normalized: NormalizedProduct = {
        amazonAsin: item.asin || summary.asin,
        sku: sku,
        name: summary.itemName || '',
        brand: summary.brandName || '',
        category: getAmzStr(item.attributes?.product_category) || '',
        mrp: 0,
        sellingPrice: 0,
        amazonRawPayload: item,
        thumbnailUrl: summary.mainImage?.link || '',
      };

      return this.success(normalized);
    } catch (error: any) {
      this.logger.error(`Failed to fetch product ${sku} from Amazon: ${error.message}`);
      return this.failure(error);
    }
  }

  async fetchProductsByAsins(
    asins: string[],
  ): Promise<ConnectorResult<NormalizedProduct[]>> {
    try {
      await this.ensureAuthenticated();

      let attempts = 0;
      let success = false;
      let items: any[] = [];

      while (attempts < 3 && !success) {
        try {
          attempts++;
          const response = await this.http.get(
            `${this.endpoint}/catalog/2022-04-01/items`,
            {
              headers: this.spApiHeaders,
              params: {
                marketplaceIds: this.marketplaceId,
                identifiers: asins.join(','),
                identifiersType: 'ASIN',
                includedData: 'attributes,dimensions,identifiers,images,productTypes,relationships,salesRanks,summaries',
              },
            },
          );

          items = (response.data?.items || []).map((item: any) => {
            let sku = item.asin;
            if (item.identifiers) {
              for (const mkt of item.identifiers) {
                if (mkt.identifiers) {
                  const skuObj = mkt.identifiers.find((i: any) => i.identifierType === 'SKU');
                  if (skuObj && skuObj.identifier) {
                    sku = skuObj.identifier;
                    break;
                  }
                }
              }
            }
            return {
              sku,
              name: item.summaries?.[0]?.itemName || item.asin,
              description: item.summaries?.[0]?.itemDescription,
              category: item.summaries?.[0]?.itemClassification,
              mrp: 0,
              sellingPrice: 0,
              rawPayload: item,
            };
          });
          success = true;
        } catch (err: any) {
          if (err.status === 429 || (err.response && err.response.status === 429)) {
            this.logger.warn(`Rate limited on fetchProductsByAsins (429). Retrying... (Attempt ${attempts}/3)`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else {
            throw err;
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 600));

      return this.success(items);
    } catch (error) {
      return this.failure(error);
    }
  }

  private async fetchSkusFromReportsApi(): Promise<string[]> {
    this.logger.log('Requesting GET_MERCHANT_LISTINGS_ALL_DATA report...');
    const reportParams = {
      reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
      marketplaceIds: [this.marketplaceId],
    };

    const reportResponse = await this.http.post(
      `${this.endpoint}/reports/2021-06-30/reports`,
      reportParams,
      { headers: this.spApiHeaders }
    );

    const reportId = reportResponse.data.reportId;
    this.logger.log(`Report created with ID: ${reportId}. Polling for completion...`);

    let reportDocumentId = null;
    let attempts = 0;
    while (attempts < 60) {
      // 60 attempts * 5s = 5 minutes timeout
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;

      const statusResponse = await this.http.get(
        `${this.endpoint}/reports/2021-06-30/reports/${reportId}`,
        { headers: this.spApiHeaders }
      );

      const status = statusResponse.data.processingStatus;
      this.logger.log(`Report ${reportId} status: ${status}`);

      if (status === 'DONE') {
        reportDocumentId = statusResponse.data.reportDocumentId;
        break;
      } else if (status === 'FATAL' || status === 'CANCELLED') {
        throw new Error(`Report generation failed with status: ${status}`);
      }
    }

    if (!reportDocumentId) {
      throw new Error(`Report generation timed out after 5 minutes`);
    }

    this.logger.log(`Report document ID: ${reportDocumentId}. Fetching document URL...`);
    const docResponse = await this.http.get(
      `${this.endpoint}/reports/2021-06-30/documents/${reportDocumentId}`,
      { headers: this.spApiHeaders }
    );

    const docUrl = docResponse.data.url;
    const compression = docResponse.data.compressionAlgorithm;

    this.logger.log(`Downloading report from URL (compression: ${compression || 'NONE'})...`);

    let tsvData = '';
    if (compression === 'GZIP') {
      const downloadResponse = await this.http.get(docUrl, { responseType: 'arraybuffer' });
      tsvData = zlib.gunzipSync(downloadResponse.data).toString('utf-8');
    } else {
      const downloadResponse = await this.http.get(docUrl, { responseType: 'text' });
      tsvData = typeof downloadResponse.data === 'string' ? downloadResponse.data : String(downloadResponse.data || '');
    }

    const lines = tsvData.split('\n');
    if (lines.length < 2) {
      this.logger.warn(`Report contains insufficient lines: ${lines.length}. First 100 chars: ${tsvData.substring(0, 100)}`);
      return [];
    }

    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
    const skuIndex = headers.indexOf('seller-sku');
    if (skuIndex === -1) {
      this.logger.warn(`Could not find 'seller-sku' column in report! Available columns: ${headers.join(', ')}`);
      return [];
    }

    const skus = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const columns = line.split('\t');
      const sku = columns[skuIndex];
      if (sku) skus.add(sku.trim());
    }

    this.logger.log(`Extracted ${skus.size} unique SKUs from report.`);
    return Array.from(skus);
  }

  // ─── Fetch ALL Seller Listings (no keyword needed) ────────────────────────
  // Uses Reports API to get every SKU a seller has, then enriches
  // each with full Catalog data (attributes, relationships, summaries, etc.)
  async fetchAllSellerListings(): Promise<ConnectorResult<NormalizedProduct[]>> {
    try {
      await this.ensureAuthenticated();

      // Step 1: Get ALL seller SKUs via Reports API
      const allSkus = await this.fetchSkusFromReportsApi();

      this.logger.log(`Found ${allSkus.length} total seller SKUs. Fetching full catalog data...`);

      if (allSkus.length === 0) {
        return this.success([]);
      }

      // Step 2: For each SKU, fetch full Catalog Item data (attributes, relationships, etc.)
      // Catalog API technically accepts up to 20 identifiers per request, but SILENTLY truncates the response to 10 items maximum.
      const allItems: NormalizedProduct[] = [];
      const chunkSize = 10;

      for (let i = 0; i < allSkus.length; i += chunkSize) {
        const chunk = allSkus.slice(i, i + chunkSize);
        this.logger.log(`Fetching catalog data for seller SKUs ${i + 1}-${Math.min(i + chunkSize, allSkus.length)}: [${chunk.join(', ')}]`);

        let attempts = 0;
        let success = false;

        while (attempts < 3 && !success) {
          try {
            attempts++;
            const catalogResponse = await this.http.get(
              `${this.endpoint}/catalog/2022-04-01/items`,
              {
                headers: this.spApiHeaders,
                params: {
                  marketplaceIds: this.marketplaceId,
                  identifiers: chunk.join(','),
                  identifiersType: 'SKU',
                  sellerId: this.sellerId,
                  includedData: 'attributes,dimensions,identifiers,images,productTypes,relationships,salesRanks,summaries',
                },
              },
            );

            const returnedItems = catalogResponse.data?.items || [];
            this.logger.log(`  Catalog returned ${returnedItems.length} items for ${chunk.length} SKUs`);

            const items = returnedItems.map((item: any) => {
              let sku = item.asin;
              if (item.identifiers) {
                for (const mkt of item.identifiers) {
                  if (mkt.identifiers) {
                    const skuObj = mkt.identifiers.find((i: any) => i.identifierType === 'SKU');
                    if (skuObj && skuObj.identifier) {
                      sku = skuObj.identifier;
                      break;
                    }
                  }
                }
              }
              return {
                sku,
                name: item.summaries?.[0]?.itemName || item.asin,
                description: item.summaries?.[0]?.itemDescription,
                category: item.summaries?.[0]?.itemClassification,
                mrp: 0,
                sellingPrice: 0,
                rawPayload: item,
              };
            });

            allItems.push(...items);
            success = true;
          } catch (err: any) {
            if (err.status === 429 || (err.response && err.response.status === 429)) {
              this.logger.warn(`Rate limited by Amazon (429). Retrying in 2 seconds... (Attempt ${attempts}/3)`);
              await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
              this.logger.error(`Failed to fetch catalog for chunk at index ${i}: ${err.message}`);
              break; // break the retry loop on non-429 errors
            }
          }
        }

        // Amazon Catalog API allows 2 requests per second. Wait 600ms between chunks to be safe.
        await new Promise(resolve => setTimeout(resolve, 600));
      }

      return this.success(allItems);
    } catch (error) {
      return this.failure(error);
    }
  }




  async patchListing(product: NormalizedProduct, changedKeys: string[]): Promise<ConnectorResult<boolean>> {
    try {
      await this.ensureAuthenticated();

      let productType = product.amazonProductType || product.erpnextRawPayload?.amazonProductType;
      const productTypeMap: Record<string, string> = { 'HOME_FURNITURE_AND_DECOR': 'SHELF' };
      if (productType && productTypeMap[productType]) productType = productTypeMap[productType];
      if (!productType) productType = 'PRODUCT';

      const requirements = productType === 'PRODUCT' ? 'LISTING_OFFER_ONLY' : 'LISTING';
      const attributes = await this.generatePayloadAttributes(product, productType, true, requirements);

      // Now filter out only the patches
      const patches: any[] = [];

      // Standard static mappings (using ERPNext keys -> Amazon keys)
      // NOTE: 'description' maps to 'product_description' because that is the attribute key
      // generated by generatePayloadAttributes() — not 'description'.
      const keyMap: Record<string, string[]> = {
        'item_name': ['item_name'],
        'brand': ['brand'],
        'description': ['product_description'],
        'custom_amazon_bullet_point': ['bullet_point'],
        'custom_depth': ['item_dimensions'],
        'custom_width': ['item_dimensions', 'item_width_height'],
        'custom_height': ['item_dimensions', 'item_width_height'],
        'custom_unit': ['item_dimensions', 'item_width_height'],
        'weight_per_unit': ['item_weight'],
      };

      // Add dynamic mappings
      const mappings = await this.mappingRepo.find({ where: { marketplace: MarketplaceSource.AMAZON } });
      for (const mapping of mappings) {
        const key = mapping.erpnextField;
        if (!keyMap[key]) {
          keyMap[key] = [];
        }
        keyMap[key].push(mapping.marketplaceField);
        if (mapping.marketplaceField.match(/item_depth|item_width|item_height|item_length|package_weight|package_height|package_width|package_length|item_package_weight/)) {
          // Also include the _unit field in the patch if we map a dimension
          keyMap[key].push(`${mapping.marketplaceField}_unit`);
        }
      }

      // Add variant mappings so changed attributes get patched
      const varMappings = await this.variantMappingRepo.find({ where: { marketplace: ILike(MarketplaceSource.AMAZON) } });
      for (const mapping of varMappings) {
        const key = mapping.erpnextAttribute; // e.g. "grid size"
        if (!keyMap[key]) {
          keyMap[key] = [];
        }
        
        let amzKey = mapping.amazonVariationTheme.toLowerCase();
        if (amzKey.includes('/')) {
          amzKey = key.toLowerCase().replace(/ /g, '_');
        }
        
        keyMap[key].push(amzKey);

        // Also map generic 'attributes' key in case ERPNext webhook sends 'attributes' as the changed child table
        if (!keyMap['attributes']) {
          keyMap['attributes'] = [];
        }
        keyMap['attributes'].push(amzKey);
      }

      const patchedPaths = new Set<string>();

      this.logger.log(`[PATCH DEBUG] changedKeys received: ${JSON.stringify(changedKeys)}`);
      this.logger.log(`[PATCH DEBUG] keyMap entries for changedKeys: ${JSON.stringify(changedKeys.map(k => ({ key: k, maps: keyMap[k] })))}`);

      for (const key of changedKeys) {
        // Skip price fields for patching, they should use price sync
        if (['price', 'sellingPrice', 'mrp', 'customAmazonPrice'].includes(key) || key.includes('price')) {
          continue;
        }

        const amazonAttrs = keyMap[key];
        if (amazonAttrs) {
          for (const attr of amazonAttrs) {
            const path = `/attributes/${attr}`;
            if (attributes[attr] !== undefined && !patchedPaths.has(path)) {
              patches.push({
                op: 'replace',
                path: path,
                value: attributes[attr]
              });
              patchedPaths.add(path);
            } else if (attributes[attr] === undefined) {
              this.logger.warn(`[PATCH DEBUG] Attribute '${attr}' is undefined in generated payload - skipping patch for key '${key}'`);
            }
          }
        } else {
          this.logger.warn(`[PATCH DEBUG] No keyMap entry for changed key '${key}' - this field won't be patched`);
        }
      }

      // Always include foundational structural fields if they exist in the generated attributes
      const foundationalFields = ['parentage_level', 'child_parent_sku_relationship', 'variation_theme'];
      for (const f of foundationalFields) {
        const path = `/attributes/${f}`;
        if (attributes[f] !== undefined && !patchedPaths.has(path)) {
          patches.push({
            op: 'replace',
            path: path,
            value: attributes[f]
          });
          patchedPaths.add(path);
        }
      }

      this.logger.log(`[PATCH DEBUG] Built ${patches.length} patches: ${JSON.stringify(patches.map(p => p.path))}`);

      if (patches.length === 0) {
        this.logger.log(`No mappable fields found for partial update of ${product.sku} (or they were price fields)`);
        return this.success(true);
      }

      this.logger.log(`Patching listing ${product.sku} on Amazon with ${patches.length} patches`);

      const payload = {
        productType,
        patches
      };

      const response = await this.http.patch(
        `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(product.sku)}`,
        payload,
        {
          headers: this.spApiHeaders,
          params: { marketplaceIds: this.marketplaceId },
        }
      );

      // SP-API returns 200 but might contain submission issues in the body
      this.logger.log(`[PATCH DEBUG] Amazon response status: ${response.status}, body: ${JSON.stringify(response.data)}`);
      const issues = response.data?.issues || [];
      const errors = issues.filter((i: any) => i.severity === 'ERROR');
      const warnings = issues.filter((i: any) => i.severity === 'WARNING');

      if (warnings.length > 0) {
        const warnMsg = warnings.map((w: any) => `[${w.code}] ${w.message}`).join(' | ');
        this.logger.warn(`[PATCH] Amazon accepted but with warnings: ${warnMsg}`);
      }

      if (errors.length > 0) {
        const errorMsg = errors.map((e: any) => `[${e.code}] ${e.message}`).join(' | ');
        this.logger.error(`Patch accepted but rejected with issues: ${errorMsg}`);
        return this.failure(`Amazon accepted patch but rejected with issues: ${errorMsg}`);
      }

      return this.success(true);
    } catch (error: any) {
      const data = error.data || error.response?.data;
      const errMsg = data?.errors?.[0]?.message || data?.issues?.[0]?.message || error.message;
      this.logger.error(`Failed to patch Amazon listing: ${errMsg}`);
      if (data) {
        this.logger.error(`Amazon full response: ${JSON.stringify(data)}`);
      }
      return this.failure(errMsg);
    }
  }



  /**
   * Builds a default amazon template JSON string for a mapping when no template is saved.
   * Checks the erpnext_product_field table to determine if the field is a Table type.
   * - Table / Table MultiSelect  → array loop with child marker
   * - Everything else            → simple scalar or standard [{value, language_tag}] wrapper
   */
  private async buildDefaultAmazonTemplate(
    erpnextField: string,
    amazonField: string,
  ): Promise<string> {
    const marketplaceId = this.marketplaceId;

    try {
      const fieldInfo = await this.erpnextProductFieldRepo.findOne({ where: { name: erpnextField } });
      const ft = (fieldInfo?.fieldtype || '').toLowerCase().trim();
      const isTable = ft === 'table' || ft === 'table multiselect';

      if (isTable) {
        // Derive child key from the field name (strip custom_ prefix)
        const childKey = erpnextField.startsWith('custom_')
          ? erpnextField.replace(/^custom_(amazon_|erpnext_)?/, '')
          : erpnextField;
        const template = {
          [amazonField]: [
            {
              value: `{{${erpnextField}[*].${childKey}}}`,
              language_tag: 'en_IN',
              marketplace_id: marketplaceId,
            },
          ],
        };
        return JSON.stringify(template);
      }
    } catch (e) {
      // If field lookup fails, fall through to scalar default
    }

    // Default scalar template
    const template = {
      [amazonField]: [
        {
          value: `{{${erpnextField}}}`,
          language_tag: 'en_IN',
          marketplace_id: marketplaceId,
        },
      ],
    };
    return JSON.stringify(template);
  }

  /**
   * Resolves a template string marker against product data.
   * Supports:
   *   {{fieldName}}            → scalar value from erp or raw or product
   *   {{fieldName[*].child}}   → child table loop — returns array of child values
   */
  private async resolveMarker(marker: string, erp: any, raw: any, product?: any): Promise<any> {
    const applyMapping = async (fieldName: string, value: any): Promise<any> => {
      if (value === undefined || value === null || value === '') return value;
      try {
        const fieldInfo = await this.erpnextProductFieldRepo.findOne({ where: { name: fieldName } });

        const isUom = (fieldInfo && fieldInfo.fieldtype === 'Link' && fieldInfo.options?.toLowerCase().trim() === 'uom') ||
          fieldName.toLowerCase().includes('uom') ||
          fieldName.toLowerCase().includes('unit');

        if (isUom) {
          // If it's wrapped in an array string from ERPNext or template, extract the inner value
          const strVal = Array.isArray(value) ? value[0] : value.toString();
          const mapped = await this.unitRepo.findOne({ where: { erpnext: strVal } });
          if (mapped && mapped.amazon) {
            // Some templates might expect the return to match the input type (array vs scalar)
            return Array.isArray(value) ? [mapped.amazon] : mapped.amazon;
          }
        }

        const isCountry = (fieldInfo && fieldInfo.fieldtype === 'Link' && fieldInfo.options?.toLowerCase().trim() === 'country') ||
          fieldName.toLowerCase().includes('country');

        if (isCountry) {
          const strVal = Array.isArray(value) ? value[0] : value.toString();
          const mapped = await this.countryRepo.findOne({ where: { erpnext: strVal } });
          if (mapped && mapped.amazon) {
            return Array.isArray(value) ? [mapped.amazon] : mapped.amazon;
          }
        }
      } catch (e) {
        // ignore mapping errors
      }
      return value;
    };

    // Child table loop: {{field[*].child}}
    const loopMatch = marker.match(/^\{\{(\w+)\[\*\]\.(\w+)\}\}$/);
    if (loopMatch) {
      const [, fieldName, childKey] = loopMatch;
      // ✅ FIX: Also check rawPayload (full product entity) for child table arrays
      const rawEntity = (product as any)?.rawPayload;
      const rawEntityErp = rawEntity?.erpnextRawPayload || {};
      const arr = erp[fieldName] ?? raw[fieldName] ?? rawEntityErp[fieldName];
      if (Array.isArray(arr)) {
        const results = [];
        for (const row of arr) {
          if (row && row[childKey] !== undefined) {
            const mappedVal = await applyMapping(childKey, row[childKey]);
            if (mappedVal !== null && mappedVal !== undefined && mappedVal !== '') {
              results.push(mappedVal);
            }
          }
        }
        return results;
      }
      return undefined;
    }

    // Scalar: {{field}}
    const scalarMatch = marker.match(/^\{\{(\w+)\}\}$/);
    if (scalarMatch) {
      const [, fieldName] = scalarMatch;
      let rawVal = erp[fieldName];
      if (rawVal === undefined || rawVal === null) rawVal = raw[fieldName];
      if ((rawVal === undefined || rawVal === null) && product) rawVal = product[fieldName as keyof NormalizedProduct];
      // ✅ FIX: Also check rawPayload entity top-level and its erpnextRawPayload for additional fallback
      if (rawVal === undefined || rawVal === null) {
        const rawEntity = (product as any)?.rawPayload;
        if (rawEntity) {
          rawVal = rawEntity[fieldName] ?? rawEntity?.erpnextRawPayload?.[fieldName];
        }
      }

      // If ERPNext sends an array for a scalar field, extract the first value
      if (Array.isArray(rawVal)) {
        rawVal = rawVal.length > 0 ? rawVal[0] : undefined;
      }

      return await applyMapping(fieldName, rawVal);
    }

    // Not a marker — static value (e.g. "en_IN")
    return marker;
  }

  /**
   * Recursively resolves all markers in a template object/array/string.
   * Special case: if a template array contains items that have loop markers,
   * it expands each row into its own object, copying static fields.
   */
  private async resolveTemplate(template: any, erp: any, raw: any, product?: any): Promise<any> {
    if (typeof template === 'string') {
      return await this.resolveMarker(template, erp, raw, product);
    }

    if (Array.isArray(template)) {
      const expanded: any[] = [];
      for (const item of template) {
        if (typeof item === 'object' && item !== null) {
          // Deeply find all loop markers
          const loopEntries: { path: string[]; values: any[] }[] = [];

          const findLoops = async (obj: any, currentPath: string[]) => {
            for (const [k, v] of Object.entries(obj)) {
              if (typeof v === 'string' && /^\{\{\w+\[\*\]\.\w+\}\}$/.test(v)) {
                const resolved = await this.resolveMarker(v, erp, raw, product);
                if (Array.isArray(resolved)) {
                  loopEntries.push({ path: [...currentPath, k], values: resolved });
                }
              } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                await findLoops(v, [...currentPath, k]);
              }
            }
          };
          await findLoops(item, []);

          // Deeply resolve static fields (ignoring loop markers)
          const resolveStatic = async (obj: any): Promise<any> => {
            const resObj: any = {};
            for (const [k, v] of Object.entries(obj)) {
              if (typeof v === 'string' && /^\{\{\w+\[\*\]\.\w+\}\}$/.test(v)) {
                continue; // Skip loop markers
              } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                const childRes = await resolveStatic(v);
                if (Object.keys(childRes).length > 0) resObj[k] = childRes;
              } else {
                const resolved = await this.resolveTemplate(v, erp, raw, product);
                if (resolved !== undefined) resObj[k] = resolved;
              }
            }
            return resObj;
          };
          const staticFields = await resolveStatic(item);

          if (loopEntries.length > 0) {
            // Expand: one output object per row of the first loop field
            const primaryLoop = loopEntries[0];
            for (let i = 0; i < primaryLoop.values.length; i++) {
              // Deep clone static fields
              const obj: any = JSON.parse(JSON.stringify(staticFields));

              // Helper to set value at path
              const setPath = (target: any, path: string[], val: any) => {
                let current = target;
                for (let p = 0; p < path.length - 1; p++) {
                  if (!current[path[p]]) current[path[p]] = {};
                  current = current[path[p]];
                }
                current[path[path.length - 1]] = val;
              };

              setPath(obj, primaryLoop.path, primaryLoop.values[i]);

              // Handle additional loop fields
              for (let j = 1; j < loopEntries.length; j++) {
                setPath(obj, loopEntries[j].path, loopEntries[j].values[i] ?? null);
              }
              expanded.push(obj);
            }
          } else {
            expanded.push(staticFields);
          }
        } else {
          expanded.push(await this.resolveTemplate(item, erp, raw, product));
        }
      }
      return expanded;
    }

    if (typeof template === 'object' && template !== null) {
      const result: any = {};
      for (const [k, v] of Object.entries(template)) {
        const res = await this.resolveTemplate(v, erp, raw, product);
        if (res !== undefined && res !== null && res !== '') {
          if (Array.isArray(res)) {
            const filteredArr = res.filter(x => x !== undefined && x !== null && x !== '');
            if (filteredArr.length > 0) {
              result[k] = filteredArr;
            }
          } else if (typeof res === 'object') {
            if (Object.keys(res).length > 0) {
              result[k] = res;
            }
          } else {
            result[k] = res;
          }
        }
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }

    return template; // number, boolean, null
  }

  async generatePayloadAttributes(product: NormalizedProduct, productType: string, isUpdate: boolean, requirements: string): Promise<any> {
    const payload: any = {
      productType,
      requirements,
      attributes: {},
    };

    if (product.amazonRawPayload?.attributes) {
      // Start with the existing Amazon attributes so we don't lose any fields not mapped in ERPNext
      payload.attributes = JSON.parse(JSON.stringify(product.amazonRawPayload.attributes));
    }

    // Overwrite with our core product fields
    payload.attributes.item_name = [{ value: product.name, language_tag: 'en_IN' }];

    if (!product.isParent && product.variantAttributes && product.variantAttributes.length > 0) {
      // Find variant mappings for this product type
      let variantMappings: AmazonVariantMapping[] = [];
      if (product.amazonProductType) {
        variantMappings = await this.variantMappingRepo.find({
          where: {
            marketplace: ILike('Amazon'),
            productType: ILike(product.amazonProductType),
          }
        });
      }

      const mappedThemes: string[] = [];

      for (const attr of product.variantAttributes) {
        const mapping = variantMappings.find(m => m.erpnextAttribute.toLowerCase() === attr.name.toLowerCase());

        if (mapping && mapping.amazonVariationTheme) {
          mappedThemes.push(mapping.amazonVariationTheme);
        }

        // If the mapping contains a slash, it's a combined theme, so we can't use it as the exact field name.
        // In that case, we fall back to the attribute name lowercased with underscores.
        let amzAttrKey = attr.name.toLowerCase().replace(/ /g, '_');
        if (mapping && mapping.amazonVariationTheme && !mapping.amazonVariationTheme.includes('/')) {
          amzAttrKey = mapping.amazonVariationTheme.toLowerCase();
        }

        if (!payload.attributes[amzAttrKey]) {
          payload.attributes[amzAttrKey] = [{ value: attr.value, language_tag: 'en_IN', marketplace_id: this.marketplaceId }];
        }
      }

      if (product.variantOf) {
        const splitMapped = mappedThemes.flatMap(t => t.split(/[-\/]/));
        const uniqueThemes = [...new Set(splitMapped)];
        const finalVariationThemeString = uniqueThemes.length > 0
          ? uniqueThemes.join('/')
          : (product.variationTheme || 'COLOR').replace(/-/g, '/');

        const themesArray = uniqueThemes.length > 0
          ? uniqueThemes.map(t => ({ name: t }))
          : (product.variationTheme || 'COLOR').split(/[-\/]/).map(t => ({ name: t }));

        payload.attributes.parentage_level = [{ value: 'child' }];
        payload.attributes.child_parent_sku_relationship = [{
          child_relationship_type: 'variation',
          parent_sku: product.variantOf,
          marketplace_id: this.marketplaceId
        }];
        payload.attributes.variation_theme = [{
          name: finalVariationThemeString,
          marketplace_id: this.marketplaceId
        }];

      }
    } else if (!product.isParent && product.variantOf) {
      // Fallback if no variant attributes but it is a child
      const fallbackThemeRaw = product.variationTheme || 'COLOR';
      const fallbackThemeString = fallbackThemeRaw.replace(/-/g, '/');
      const fallbackThemesArray = fallbackThemeRaw.split(/[-\/]/).map(t => ({ name: t }));

      payload.attributes.parentage_level = [{ value: 'child' }];
      payload.attributes.child_parent_sku_relationship = [{
        child_relationship_type: 'variation',
        parent_sku: product.variantOf,
        marketplace_id: this.marketplaceId
      }];
      payload.attributes.variation_theme = [{
        name: fallbackThemeString,
        marketplace_id: this.marketplaceId
      }];
      payload.attributes.condition_type = [{
        value: 'new_new',
        marketplace_id: this.marketplaceId
      }];
    }
    payload.attributes.condition_type = [{
      value: 'new_new',
      marketplace_id: this.marketplaceId
    }];
    if (product.description) {
      const plainTextDescription = product.description
        .replace(/<br\s*[\/]?>/gi, '\n') // Replace <br> with newlines
        .replace(/<\/p>/gi, '\n\n') // Replace </p> with double newlines
        .replace(/<[^>]+>/g, '') // Strip remaining HTML tags
        .replace(/&nbsp;/g, ' ') // Decode common entities
        .replace(/&amp;/g, '&')
        .trim();
      payload.attributes.product_description = [{ value: plainTextDescription, language_tag: 'en_IN' }];
    }


    const erpRaw = product.erpnextRawPayload || {};
    const baseUrl = this.config.get<string>('erpnext.baseUrl') || '';

    let mainImage = null;
    let otherImages: string[] = [];

    // Primary image lookup
    if (erpRaw.custom_thumbnail_image) {
      mainImage = erpRaw.custom_thumbnail_image;
    } else if (erpRaw.image) {
      mainImage = erpRaw.image;
    } else if (erpRaw.attachments && erpRaw.attachments.length > 0 && erpRaw.attachments[0].file_url) {
      mainImage = erpRaw.attachments[0].file_url;
    }

    if (mainImage && mainImage.startsWith('/')) {
      const clean = mainImage.substring(1);
      mainImage = clean.startsWith('http') ? clean : `${baseUrl}/${clean}`;
    }

    // Other images lookup
    if (erpRaw.image && erpRaw.image !== erpRaw.custom_thumbnail_image) {
      let url = erpRaw.image;
      if (url.startsWith('/')) url = url.substring(1);
      url = url.startsWith('http') ? url : `${baseUrl}/${url}`;
      if (url !== mainImage) otherImages.push(url);
    }

    if (erpRaw.attachments && Array.isArray(erpRaw.attachments)) {
      for (const att of erpRaw.attachments) {
        if (att.file_url) {
          let url = att.file_url;
          if (url.startsWith('/')) url = url.substring(1);
          url = url.startsWith('http') ? url : `${baseUrl}/${url}`;
          if (url !== mainImage && !otherImages.includes(url)) {
            otherImages.push(url);
          }
        }
      }
    }

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

    // if (!product.isParent) {
    //   if (product.upc) {
    //     payload.attributes.externally_assigned_product_identifier = [{
    //       type: 'upc',
    //       value: product.upc,
    //     }];
    //   } else if (product.erpnextRawPayload?.ean) {
    //     payload.attributes.externally_assigned_product_identifier = [{
    //       type: 'ean',
    //       value: product.erpnextRawPayload.ean
    //     }];
    //   }
    // }

    if (!product.isParent && isUpdate) {
      payload.attributes.purchasable_offer = [{
        currency: 'INR',
        our_price: [{ schedule: [{ value_with_tax: product.sellingPrice }] }],
        maximum_retail_price: product.mrp ? [{ schedule: [{ value_with_tax: product.mrp }] }] : undefined
      }];

      if (product.availableQty !== undefined && product.availableQty !== null) {
        payload.attributes.fulfillment_availability = [{
          fulfillment_channel_code: 'DEFAULT',
          quantity: product.availableQty
        }];
      }
    }

    if (product.isParent) {
      payload.attributes.parentage_level = [{ value: 'parent' }];
      payload.attributes.child_parent_sku_relationship = [{
        child_relationship_type: 'variation',
        marketplace_id: this.marketplaceId
      }];

      const attrs = product.erpnextRawPayload?.attributes;
      if (Array.isArray(attrs) && attrs.length > 0) {
        const mappedThemes: string[] = [];
        for (const attr of attrs) {
          if (attr.attribute) {
            const mapping = await this.variantMappingRepo.findOne({
              where: {
                marketplace: ILike(MarketplaceSource.AMAZON),
                productType: ILike(productType),
                erpnextAttribute: ILike(attr.attribute)
              }
            });
            if (mapping && mapping.amazonVariationTheme) {
              mappedThemes.push(mapping.amazonVariationTheme);
            }

            // Dynamically populate parent payload attributes if they have a value in ERPNext
            if (attr.attribute_value) {
              let amzAttrKey = attr.attribute.toLowerCase().replace(/ /g, '_');
              if (mapping && mapping.amazonVariationTheme && !mapping.amazonVariationTheme.includes('/')) {
                amzAttrKey = mapping.amazonVariationTheme.toLowerCase();
              }
              if (!payload.attributes[amzAttrKey]) {
                payload.attributes[amzAttrKey] = [{ value: attr.attribute_value, language_tag: 'en_IN', marketplace_id: this.marketplaceId }];
              }
            }
          }
        }

        const splitMapped = mappedThemes.flatMap(t => t.split(/[-\/]/));
        const uniqueThemes = [...new Set(splitMapped)];
        if (uniqueThemes.length > 0) {
          payload.attributes.variation_theme = [{ 
            name: uniqueThemes.join('/'),
            marketplace_id: this.marketplaceId 
          }];
        }
      }
    }

    const rawPayloadEntity = (product as any).rawPayload || {};
    const erpFallback: Record<string, any> =
      (typeof rawPayloadEntity?.erpnextRawPayload === 'object' && rawPayloadEntity.erpnextRawPayload)
        ? rawPayloadEntity.erpnextRawPayload
        : {};
    const erp: Record<string, any> = Object.keys(product.erpnextRawPayload || {}).length > 0
      ? (product.erpnextRawPayload || {})
      : erpFallback;
    const raw = product.amazonRawPayload || {};



    // Also build a merged product-level field lookup (covers top-level fields like weight, brand, etc.)
    const productTopLevel: Record<string, any> = {
      mrp: product.mrp,
      sellingPrice: product.sellingPrice,
      thumbnailUrl: mainImage,
      amazonProductType: product.amazonProductType,
    };

    // --- DYNAMIC FIELD MAPPING ---
    try {
      const mappings = await this.mappingRepo.find({
        where: {
          marketplace: MarketplaceSource.AMAZON,
          productType: productType
        }
      });
      // erp and raw are already defined above with fallback chain

      for (const mapping of mappings) {
        // Determine template: use saved amazonTemplate, or auto-generate a default one
        let templateStr = mapping.amazonTemplate?.trim() || '';
        if (!templateStr && mapping.erpnextField && mapping.erpnextField.trim()) {
          templateStr = await this.buildDefaultAmazonTemplate(mapping.erpnextField, mapping.marketplaceField);
        }

        if (templateStr) {
          try {
            const templateObj = JSON.parse(templateStr);

            // ✅ If the template has NO {{markers}}, send it as-is (fixed/static value)
            const hasMarkers = /\{\{[^}]+\}\}/.test(templateStr);
            if (!hasMarkers) {
              // Apply template keys directly to payload — no resolution needed
              for (const [key, val] of Object.entries(templateObj)) {
                if (val !== undefined && val !== null && !(Array.isArray(val) && (val as any[]).length === 0)) {
                  payload.attributes[key] = val;
                }
              }
              continue;
            }

            // Has markers — resolve dynamically
            const resolved = await this.resolveTemplate(templateObj, erp, raw, product);
            for (const [key, val] of Object.entries(resolved)) {
              let finalVal = val;

              if (key === 'product_description' || key === 'description') {
                const stripHtml = (str: string) => typeof str === 'string' ? str
                  .replace(/<br\s*[\/]?>/gi, '\n')
                  .replace(/<\/p>/gi, '\n\n')
                  .replace(/<[^>]+>/g, '')
                  .replace(/&nbsp;/g, ' ')
                  .replace(/&amp;/g, '&')
                  .trim() : str;

                if (typeof finalVal === 'string') {
                  finalVal = stripHtml(finalVal);
                } else if (Array.isArray(finalVal)) {
                  finalVal = finalVal.map(item => {
                    if (item && typeof item === 'object' && typeof item.value === 'string') {
                      return { ...item, value: stripHtml(item.value) };
                    }
                    return item;
                  });
                }
              }

              // Ensure scalar values (e.g. from {"model_number": "{{item_code}}"}) are wrapped in the standard Amazon array format
              if (finalVal !== undefined && finalVal !== null && !Array.isArray(finalVal)) {
                if (typeof finalVal !== 'object') {
                  finalVal = [{ value: finalVal, language_tag: 'en_IN', marketplace_id: this.marketplaceId }];
                } else {
                  finalVal = [finalVal];
                }
              }

              // Filter out array items that are missing their critical data properties
              if (Array.isArray(finalVal)) {
                finalVal = finalVal.filter((item: any) => {
                  if (item && typeof item === 'object') {
                    if ('media_location' in item) {
                      return item.media_location !== undefined && item.media_location !== null && item.media_location !== '';
                    }
                    if ('value' in item) {
                      return item.value !== undefined && item.value !== null && item.value !== '';
                    }
                    // If it's an object but has NEITHER 'value' nor 'media_location', we check if it has any data keys.
                    // If it only has 'language_tag' or 'marketplace_id', the data value resolved to undefined/empty.
                    const dataKeys = Object.keys(item).filter(k => k !== 'language_tag' && k !== 'marketplace_id');
                    if (dataKeys.length > 0) {
                      return dataKeys.some(k => item[k] !== undefined && item[k] !== null && item[k] !== '');
                    }
                    return false; // Effectively empty (only has metadata keys)
                  }
                  return item !== undefined && item !== null && item !== '';
                });
              }

              // If empty after resolution, apply the static default value if provided
              if ((!finalVal || (Array.isArray(finalVal) && finalVal.length === 0)) && mapping.defaultValue && mapping.defaultValue.trim() !== '') {
                finalVal = [{ value: mapping.defaultValue, language_tag: 'en_IN', marketplace_id: this.marketplaceId }];
              }


              if (finalVal !== undefined && finalVal !== null && !(Array.isArray(finalVal) && finalVal.length === 0)) {
                if (!payload.attributes[key]) {
                  payload.attributes[key] = finalVal;
                }
              }
            }
          } catch (e) {
            this.logger.warn(`Failed to apply template for mapping ${mapping.marketplaceField}: ${e.message}`);
          }
          continue;
        }

        // --- Legacy fallback: no template — derive value from raw field ---
        let val: any = undefined;

        // 1st: Check if mapped with specific ERPNext field
        if (mapping.erpnextField && mapping.erpnextField.trim() !== '') {
          val = erp[mapping.erpnextField];
          if (val === undefined || val === null) {
            val = raw[mapping.erpnextField];
          }
          if (val === undefined || val === null) {
            val = product[mapping.erpnextField as keyof NormalizedProduct];
          }
        }

        // 2nd: If field not selected or empty value, check if defaultValue is set
        if ((val === undefined || val === null || val === '') && mapping.defaultValue && mapping.defaultValue.trim() !== '') {
          val = mapping.defaultValue;
        }

        if (val !== undefined && val !== null && val !== '') {
          // Special handling for Amazon's strict schemas
          const field = mapping.marketplaceField;

          if (Array.isArray(val) && val.length > 0) {
            const mappedArray = val.map(v => {
              if (typeof v === 'object') {
                const validKeys = Object.keys(v).filter(k => !['name', 'owner', 'creation', 'modified', 'modified_by', 'docstatus', 'idx', 'parent', 'parentfield', 'parenttype'].includes(k));
                if (validKeys.length > 0) {
                  return { value: v[validKeys[0]].toString(), language_tag: 'en_IN' };
                }
                return { value: Object.values(v)[0].toString(), language_tag: 'en_IN' };
              }
              return { value: v.toString(), language_tag: 'en_IN' };
            });
            if (mappedArray.length > 0) {
              if (!payload.attributes[field]) {
                payload.attributes[field] = mappedArray;
              }
            }
          } else {
            if (!payload.attributes[field]) {
              payload.attributes[field] = [{ value: val.toString(), language_tag: 'en_IN' }];
            }
          }
        }
      }
    } catch (err) {
      this.logger.error(`Failed to apply dynamic mappings: ${err.message}`);
    }

    // ─── POST-PROCESSING: Normalize unit strings using unitRepo (DB table) ───
    // This fixes cases where a mapping template sends an ERPNext UOM name like "Gram"
    // and we need the Amazon-accepted equivalent like "grams".

    /**
     * Looks up a unit string in the unitRepo and returns the Amazon equivalent.
     * Also handles the case where the unit is stored as an array (e.g. from a malformed template).
     */
    const resolveUnit = async (rawUnit: string | string[] | undefined): Promise<string | undefined> => {
      if (!rawUnit) return undefined;
      const unitStr = Array.isArray(rawUnit) ? rawUnit[0] : rawUnit;
      if (!unitStr) return undefined;
      try {
        const mapped = await this.unitRepo.findOne({ where: { erpnext: unitStr } });
        return mapped?.amazon || unitStr;
      } catch (_) {
        return unitStr;
      }
    };

    // Normalize item_weight unit via unitRepo
    if (payload.attributes.item_weight) {
      for (let i = 0; i < payload.attributes.item_weight.length; i++) {
        const w = payload.attributes.item_weight[i];
        if (w.unit) {
          const resolved = await resolveUnit(w.unit);
          if (resolved) payload.attributes.item_weight[i] = { ...w, unit: resolved };
        }
      }
    }

    // Normalize item_package_weight unit via unitRepo
    if (payload.attributes.item_package_weight) {
      for (let i = 0; i < payload.attributes.item_package_weight.length; i++) {
        const w = payload.attributes.item_package_weight[i];
        if (w.unit) {
          const resolved = await resolveUnit(w.unit);
          if (resolved) payload.attributes.item_package_weight[i] = { ...w, unit: resolved };
        }
      }
    }
    // SKU is passed in the URL for SP-API, it shouldn't be in the payload attributes
    if (payload.attributes.sku) {
      delete payload.attributes.sku;
    }

    // Sanitize variation_theme to ALWAYS use slashes instead of hyphens
    if (payload.attributes.variation_theme && Array.isArray(payload.attributes.variation_theme)) {
      payload.attributes.variation_theme = payload.attributes.variation_theme.map((t: any) => {
        if (t && typeof t.name === 'string') {
          return { ...t, name: t.name.replace(/-/g, '/') };
        }
        return t;
      });
    }

    // Ensure variation attributes are NEVER sent for parent products
    if (product.isParent) {
      // NOTE: We used to delete child_parent_sku_relationship here, but it IS required for parent products now.
      if (product.variantAttributes && product.variantAttributes.length > 0) {
        for (const attr of product.variantAttributes) {
          delete payload.attributes[attr.name.toLowerCase()];
        }
      }
    }

    return payload.attributes;
  }


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

      // Determine product type. Amazon requires specific types (e.g. MUG, SHIRT) to create new products.
      let productType = product.amazonProductType || product.erpnextRawPayload?.amazonProductType;

      let requirements = 'LISTING_OFFER_ONLY';
      if (productType && productType !== 'PRODUCT') {
        requirements = 'LISTING';
      } else {
        productType = 'PRODUCT'; // Default to PRODUCT if not mapped
      }

      let response;
      let usedMethod = 'PATCH';

      try {
        // ALWAYS try PATCH first (update mode)
        const patchAttributes = await this.generatePayloadAttributes(product, productType, true, requirements);

        const patchOperations = Object.keys(patchAttributes).map(key => ({
          op: 'replace',
          path: `/attributes/${key}`,
          value: patchAttributes[key]
        }));

        const payload: any = {
          productType,
          patches: patchOperations,
        };

        this.logger.debug(`PATCH Listings patches for ${product.sku}: ` + JSON.stringify(payload.patches, null, 2));

        response = await this.http.patch(
          `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(product.sku)}`,
          payload,
          {
            headers: this.spApiHeaders,
            params: { marketplaceIds: this.marketplaceId, issueLocale: 'en_IN' },
          },
        );
      } catch (err: any) {
        // If PATCH returns 404 Not Found, it means the listing does not exist in SP-API. Fallback to PUT.
        if (err.status === 404 || err.response?.status === 404 || err.message?.includes('404')) {
          this.logger.debug(`PATCH returned 404 Not Found for ${product.sku}, falling back to PUT for new listing.`);
          usedMethod = 'PUT';

          if (productType === 'PRODUCT') {
            return this.failure("Amazon Product Type is required to create new products on Amazon. The generic 'PRODUCT' type is not allowed for new listings.");
          }

          const putAttributes = await this.generatePayloadAttributes(product, productType, false, requirements);
          const payload: any = {
            productType,
            requirements,
            attributes: putAttributes,
          };

          this.logger.debug(`PUT Listings attributes for ${product.sku}: ` + JSON.stringify(payload.attributes, null, 2));

          response = await this.http.put(
            `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(product.sku)}`,
            payload,
            {
              headers: this.spApiHeaders,
              params: { marketplaceIds: this.marketplaceId, issueLocale: 'en_IN' },
            },
          );
        } else {
          throw err;
        }
      }

      // SP-API returns 200/202 but might contain submission issues in the body
      const data = response.data || {};
      const issues = data.issues || [];

      if (issues.length > 0) {
        this.logger.warn(`Amazon Sync Issues for ${product.sku}: ` + JSON.stringify(issues));
        const errorMsg = issues.map((e: any) => `[${e.severity || 'ISSUE'}] [${e.code}] ${e.message}`).join(' | ');
        return this.failure(`Amazon returned issues during sync: ${errorMsg}`, 400);
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
          params: { marketplaceIds: this.marketplaceId, includedData: 'summaries,issues' },
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


  // ─── Delete Listing ───────────────────────────────────────────────────────

  async deleteItem(sku: string): Promise<ConnectorResult<boolean>> {
    try {
      await this.ensureAuthenticated();

      const response = await this.http.delete(
        `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(sku)}`,
        {
          headers: this.spApiHeaders,
          params: { marketplaceIds: this.marketplaceId },
        },
      );

      const data = response.data || {};
      const issues = data.issues || [];
      const errors = issues.filter((i: any) => i.severity === 'ERROR');

      if (errors.length > 0) {
        const errorMsg = errors.map((e: any) => `[${e.code}] ${e.message}`).join(' | ');
        return this.failure(`Failed to delete Amazon listing: ${errorMsg}`, 400);
      }

      return this.success(true);
    } catch (error: any) {
      if (error.response?.status === 404) {
        return this.success(true); // Ignore if already deleted/not found
      }
      return this.failure(error);
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
            const isParent = item.isParent || false;

            if (isParent) {
              this.logger.debug(`Skipping inventory update for parent item ${item.sku}`);
              result.success++;
              continue;
            }

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
              productType: item.productType || 'PRODUCT',
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
                      ],
                      maximum_retail_price: item.mrp ? [
                        {
                          schedule: [
                            {
                              value_with_tax: item.mrp
                            }
                          ]
                        }
                      ] : undefined
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

  async fetchListingPricing(sku: string): Promise<any> {
    try {
      await this.ensureAuthenticated();
      const response = await this.http.get(
        `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(sku)}`,
        {
          headers: this.spApiHeaders,
          params: {
            marketplaceIds: this.marketplaceId,
            includedData: 'attributes,issues'
          },
        }
      );
      return { success: true, data: response.data };
    } catch (error: any) {
      this.logger.error(`Failed to fetch pricing for ${sku}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // ─── Validate Listing ─────────────────────────────────────────────────────
  
  async validateListing(product: any): Promise<ConnectorResult<any>> {
    try {
      await this.ensureAuthenticated();
      if (!product) {
        return this.failure(`Product not provided`);
      }
      const sku = product.sku;

      let productType = product.amazonProductType || product.erpnextRawPayload?.amazonProductType || 'PRODUCT';
      let requirements = productType !== 'PRODUCT' ? 'LISTING' : 'LISTING_OFFER_ONLY';
      
      const putAttributes = await this.generatePayloadAttributes(product as any, productType, false, requirements);
      
      const payload: any = {
        productType,
        requirements,
        attributes: putAttributes,
      };

      const response = await this.http.put(
        `${this.endpoint}/listings/2021-08-01/items/${this.sellerId}/${encodeURIComponent(sku)}`,
        payload,
        {
          headers: this.spApiHeaders,
          params: { 
            marketplaceIds: this.marketplaceId, 
            mode: 'VALIDATION_PREVIEW',
            issueLocale: 'en_IN' 
          },
        }
      );

      return this.success({ issues: response.data?.issues || [] });
    } catch (error: any) {
      if (error.response?.data?.issues) {
         return this.success({ issues: error.response.data.issues });
      }
      return this.failure(error);
    }
  }

}
