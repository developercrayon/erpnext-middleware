import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, ILike, IsNull } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Product, ProductStatus } from '../../database/entities/product.entity';
import { ERPNextService } from '../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../connectors/flipkart/flipkart.connector';
import { QUEUE_NAMES, JOB_NAMES, QUEUE_DEFAULT_OPTIONS } from '../queue/queue.constants';
import { MarketplaceSource } from '../../database/entities/order.entity';
import { ProductQueryDto } from './dto/product.dto';

import { QueueJob, QueueJobStatus } from '../../database/entities/operational.entity';
import { FieldMapping } from '../../database/entities/mapping.entity';
import { ErpnextProductField } from '../../database/entities/erpnext-product-field.entity';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(FieldMapping)
    private readonly mappingRepo: Repository<FieldMapping>,
    @InjectRepository(ErpnextProductField)
    private readonly erpnextFieldRepo: Repository<ErpnextProductField>,
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectQueue(QUEUE_NAMES.PRODUCTS)
    private readonly productsQueue: Queue,
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
  ) { }

  // ─── Query Methods ────────────────────────────────────────────────────────

  async fetchFromAmazonAndStore(): Promise<any> {
    this.logger.log('Fetching ALL products from Amazon via Reports API (GET_MERCHANT_LISTINGS_ALL_DATA)...');
    let allItems: any[] = [];

    // ── PRIMARY: Reports API → returns every SKU the seller has ──────
    // This is the correct approach — no keyword needed, no missing products.
    const listingsResult = await this.amazonConnector.fetchAllSellerListings();
    if (listingsResult.success && listingsResult.data && listingsResult.data.length > 0) {
      allItems = listingsResult.data;
      this.logger.log(`Reports API returned ${allItems.length} products.`);
    } else if (!listingsResult.success) {
      this.logger.error(`Failed to fetch from Amazon: ${listingsResult.error}`);
      throw new Error(listingsResult.error || 'Failed to fetch from Amazon');
    }


    // Save initial fetch to JSON file for observation
    const logsDir = path.join(process.cwd(), 'logs');
    await fs.mkdir(logsDir, { recursive: true });
    let jsonPath = path.join(logsDir, `amazon_products_initial_${Date.now()}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(allItems, null, 2), 'utf-8');

    // FETCH MISSING PARENTS AND SIBLINGS
    const fetchedAsins = new Set(allItems.map(i => i.sku));
    const missingAsins = new Set<string>();

    for (const item of allItems) {
      const relationshipsData = item.rawPayload?.relationships;
      if (relationshipsData && Array.isArray(relationshipsData)) {
        for (const marketplaceData of relationshipsData) {
          const rels = marketplaceData.relationships;
          if (rels && Array.isArray(rels)) {
            for (const r of rels) {
              if (r.parentAsins && Array.isArray(r.parentAsins)) {
                r.parentAsins.forEach((asin: string) => {
                  if (!fetchedAsins.has(asin)) missingAsins.add(asin);
                });
              }
              if (r.childAsins && Array.isArray(r.childAsins)) {
                r.childAsins.forEach((asin: string) => {
                  if (!fetchedAsins.has(asin)) missingAsins.add(asin);
                });
              }
              if (r.children && Array.isArray(r.children)) {
                r.children.forEach((asin: string) => {
                  if (!fetchedAsins.has(asin)) missingAsins.add(asin);
                });
              }
            }
          }
        }
      }
    }

    const missingAsinsArray = Array.from(missingAsins);
    if (missingAsinsArray.length > 0) {
      this.logger.log(`Found ${missingAsinsArray.length} missing related ASINs (parents/variants). Fetching them now...`);
      for (let i = 0; i < missingAsinsArray.length; i += 20) {
        const chunk = missingAsinsArray.slice(i, i + 20);
        this.logger.log(`Fetching chunk of ${chunk.length} missing ASINs...`);
        try {
          const chunkResponse = await this.amazonConnector.fetchProductsByAsins(chunk);
          if (chunkResponse.success && chunkResponse.data) {
            allItems = allItems.concat(chunkResponse.data);
          }
        } catch (err: any) {
          this.logger.error(`Failed to fetch chunk of missing ASINs: ${err.message}`);
        }
      }

      // Amazon Catalog API often DOES NOT return virtual parent ASINs or inactive items.
      // We will create stub items for any ASINs that are STILL missing so they map correctly in our DB.
      const successfullyFetchedSkus = new Set(allItems.map(i => i.sku));
      let stubsCreated = 0;
      for (const missingAsin of missingAsinsArray) {
        if (!successfullyFetchedSkus.has(missingAsin)) {
          stubsCreated++;
          allItems.push({
            sku: missingAsin,
            name: `Template ${missingAsin}`,
            description: 'Auto-generated stub for missing Amazon item',
            category: 'Unknown',
            mrp: 0,
            sellingPrice: 0,
            rawPayload: {
              attributes: {
                parentage_level: [{ value: 'parent' }]
              },
              relationships: [{
                marketplaceId: 'stub',
                relationships: [{
                  type: 'VARIATION',
                  children: ['stub-child'] // forces it to be recognized as a parent
                }]
              }]
            }
          });
        }
      }
      if (stubsCreated > 0) {
        this.logger.log(`Created ${stubsCreated} stub items for ASINs that Amazon refused to return.`);
      }

      // Update JSON log with all items including variants and stubs
      jsonPath = path.join(logsDir, `amazon_products_complete_${Date.now()}.json`);
      await fs.writeFile(jsonPath, JSON.stringify(allItems, null, 2), 'utf-8');
    }

    this.logger.log(`Total fetched products from Amazon (including relationships): ${allItems.length}`);

    // Helper to extract value from Amazon SP-API attribute format (e.g. [{value: "..."}])
    const getAmzStr = (attrs: any, key: string) => attrs?.[key]?.[0]?.value || null;
    const getAmzNum = (attrs: any, key: string) => attrs?.[key]?.[0]?.value ? parseFloat(attrs[key][0].value) : null;
    const getAmzObj = (attrs: any, key: string) => attrs?.[key] || null;

    const savedProducts = [];
    // Map and save to middleware DB with isFromAmazon flag
    for (const item of allItems) {
      const rawPayloadAttrs = item.rawPayload?.attributes || {};
      const attrs = rawPayloadAttrs.attributes || rawPayloadAttrs;

      const mappedData: Partial<Product> = {
        name: getAmzStr(attrs, 'item_name') || item.name,
        description: getAmzStr(attrs, 'product_description') || item.description,
        brand: getAmzStr(attrs, 'brand') || item.brand,
        customModelName: getAmzStr(attrs, 'model_name'),
        customStyle: getAmzStr(attrs, 'style'),
        customNumberOfItems: getAmzNum(attrs, 'number_of_items'),
        customColor: getAmzStr(attrs, 'color'),
        customNumberOfPieces: getAmzNum(attrs, 'number_of_pieces'),
        customModelNumber: getAmzStr(attrs, 'model_number'),
        customManufacturerContactInfo: getAmzStr(attrs, 'manufacturer_contact_information') || getAmzStr(attrs, 'rtip_manufacturer_contact_information'),
        customDepth: attrs?.item_dimensions?.[0]?.depth?.value,
        customWidth: attrs?.item_dimensions?.[0]?.width?.value,
        customHeight: attrs?.item_dimensions?.[0]?.height?.value,
        customNumberOfPacks: getAmzNum(attrs, 'number_of_packs'),
        customExternalProductInformation: getAmzStr(attrs, 'external_product_information'),
        customShelfThickness: getAmzNum(attrs, 'shelf_thickness'),
        customAssemblyInstructions: getAmzStr(attrs, 'assembly_instructions'),
        customItemShape: getAmzStr(attrs, 'item_shape'),
        customShelfType: getAmzStr(attrs, 'shelf_type'),
        customNumberOfShelves: getAmzNum(attrs, 'number_of_shelves'),
        customMountingType: getAmzStr(attrs, 'mounting_type'),
        customFinishType: getAmzStr(attrs, 'finish_type'),
        customIncludedComponents: getAmzObj(attrs, 'included_components'),
        customAmazonBulletPoint: getAmzObj(attrs, 'bullet_point'),
        customPackerContactInformation: getAmzObj(attrs, 'packer_contact_information'),
        customSpecificUsesForProduct: getAmzObj(attrs, 'specific_uses_for_product'),
        customRecommendedUsesForProduct: getAmzObj(attrs, 'recommended_uses_for_product'),
        customRoomType: getAmzObj(attrs, 'room_type'),
        customSpecialFeature: getAmzObj(attrs, 'special_feature'),
        customCareInstructions: getAmzObj(attrs, 'care_instructions'),
        attributes: item.rawPayload,
      };

      let isParent = false;
      let variantOf = null;
      let variationTheme = null;
      let variantAttributes = null;

      const relationshipsData = item.rawPayload?.relationships;
      if (relationshipsData && Array.isArray(relationshipsData)) {
        for (const marketplaceData of relationshipsData) {
          const rels = marketplaceData.relationships;
          if (rels && Array.isArray(rels)) {
            const variationRel = rels.find((r: any) => r.type === 'VARIATION' || r.parentAsins || r.children || r.childAsins);
            if (variationRel) {
              if (variationRel.parentAsins && variationRel.parentAsins.length > 0) {
                variantOf = variationRel.parentAsins[0];
                isParent = false; // explicitly a child
              } else {
                if (variationRel.children && variationRel.children.length > 0) {
                  isParent = true;
                }
                if (variationRel.childAsins && variationRel.childAsins.length > 0) {
                  isParent = true;
                }
              }
              if (variationRel.variationTheme?.attributes) {
                const themeAttrs = variationRel.variationTheme.attributes;
                variationTheme = themeAttrs.join('-');

                variantAttributes = themeAttrs.map((attr: string) => ({
                  name: attr.charAt(0).toUpperCase() + attr.slice(1), // e.g. "size" -> "Size"
                  value: getAmzStr(attrs, attr) || ''
                }));
              }
              break;
            }
          }
        }
      }

      // Also set the item status based on Amazon data (if we can infer it)
      // Usually, if it's fetched, it's active unless we know otherwise.
      // But user requested to disable ERPNext items if Amazon is draft.
      // We will set status based on purchasing functionality if available, else Active.
      let mappedStatus = ProductStatus.ACTIVE;
      const summaries = item.rawPayload?.summaries?.[0];
      if (summaries?.status === 'DRAFT' || item.rawPayload?.status === 'DRAFT') {
        mappedStatus = ProductStatus.DRAFT;
      }

      let product = await this.findBySku(item.sku);
      if (!product) {
        product = this.productRepo.create({
          sku: item.sku,
          category: item.category,
          status: mappedStatus,
          isFromAmazon: true,
          isParent,
          variantOf,
          variationTheme,
          variantAttributes,
          mrp: 0,
          sellingPrice: 0,
          ...mappedData
        });
      } else {
        product.isFromAmazon = true;
        product.isParent = isParent;
        product.variantOf = variantOf;
        product.variationTheme = variationTheme;
        if (variantAttributes) product.variantAttributes = variantAttributes;
        if (mappedStatus === ProductStatus.DRAFT) product.status = mappedStatus;
        Object.assign(product, mappedData);
      }

      const saved = await this.productRepo.save(product);
      savedProducts.push(saved);
    }

    return {
      message: 'Products fetched and stored successfully',
      fileSavedAt: jsonPath,
      count: savedProducts.length,
      sample: savedProducts.slice(0, 5)
    };
  }

  async findAll(query: ProductQueryDto): Promise<{ data: Product[]; total: number }> {
    const { status, marketplace, sku, category, brand, page = 1, pageSize = 20 } = query;

    const where: any = {};
    if (status) where.status = status;
    if (sku) where.sku = ILike(`%${sku}%`);
    if (category) where.category = ILike(`%${category}%`);
    if (brand) where.brand = ILike(`%${brand}%`);
    if (marketplace === MarketplaceSource.AMAZON) where.isAmazonListed = true;
    if (marketplace === MarketplaceSource.FLIPKART) where.isFlipkartListed = true;

    const options: FindManyOptions<Product> = {
      where,
      order: { updatedAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    const [data, total] = await this.productRepo.findAndCount(options);
    return { data, total };
  }

  async findBySku(sku: string): Promise<Product | null> {
    return this.productRepo.findOne({ where: { sku } });
  }

  async findById(id: string): Promise<Product | null> {
    return this.productRepo.findOne({ where: { id } });
  }
  // ─── Direct ERPNext API Methods ──────────────────────────────────────────

  async getReferenceData(): Promise<any> {
    const res = await this.erpnextService['connector'].getReferenceData();
    if (!res.success) throw new Error(res.error || 'Failed to fetch');
    return res.data;
  }

  async getItemSchema(): Promise<any> {
    const res = await this.erpnextService['connector'].getItemSchema();
    if (!res.success) throw new Error(res.error || 'Failed to fetch schema');
    return res.data;
  }

  async getFullItem(id: string): Promise<any> {
    const product = await this.findById(id);
    if (!product || !product.erpnextItemCode) throw new Error('Product not found or has no ERPNext item code');
    const res = await this.erpnextService['connector'].getFullItem(product.erpnextItemCode);
    if (!res.success) throw new Error(res.error || 'Failed to fetch full item');
    return res.data;
  }

  async getLinkOptions(doctype: string, query?: string): Promise<any> {
    const res = await this.erpnextService['connector'].getLinkOptions(doctype, query);
    if (!res.success) throw new Error(res.error || 'Failed to fetch options');
    return res.data;
  }

  async pushToERPNext(id: string): Promise<Product> {
    const product = await this.findById(id);
    if (!product) throw new Error('Product not found');

    this.logger.debug(`[DEBUG] Product: ${JSON.stringify(product)}`);

    // ── Base payload (always present regardless of field mapping) ─────────────
    let sellerSku = product.sku;
    if (product.attributes && Array.isArray(product.attributes.identifiers)) {
      for (const idGroup of product.attributes.identifiers) {
        if (Array.isArray(idGroup.identifiers)) {
          const skuObj = idGroup.identifiers.find((i: any) => i.identifierType === 'SKU');
          if (skuObj && skuObj.identifier) {
            sellerSku = skuObj.identifier;
            break;
          }
        }
      }
    }

    const erpPayload: Record<string, any> = {
      item_code: sellerSku,
      sku: sellerSku,
      item_name: (product.name || sellerSku).substring(0, 140),
      description: product.description || '',
      item_group: 'Products',
      custom_amazon: 1,
      disabled: 0,
      is_sales_item: 0,
    };

    // ── Variant handling ───────────────────────────────────────────────────────
    if (product.isParent) {
      erpPayload.has_variants = 1;
      let parentAttrs = product.variantAttributes || [];
      
      // If parent has no attributes (e.g. auto-generated stub), infer from children
      if (parentAttrs.length === 0) {
        const children = await this.productRepo.find({ where: { variantOf: product.sku } });
        const uniqueAttrNames = new Set<string>();
        for (const child of children) {
          if (child.variantAttributes) {
            for (const attr of child.variantAttributes) {
              if (attr.name) uniqueAttrNames.add(attr.name);
            }
          }
        }
        parentAttrs = Array.from(uniqueAttrNames).map(name => ({ name, value: '' }));
      }

      // 🔴 FIX: Frappe STRICTLY requires at least one attribute for a Template item
      if (parentAttrs.length === 0) {
        const connector = this.erpnextService['connector'];
        const fallbackAttr = 'Variant Attribute';
        await connector.ensureItemAttributeExists(fallbackAttr, 'Stub');
        parentAttrs = [{ name: fallbackAttr, value: '' }];
      }

      if (parentAttrs.length > 0) {
        erpPayload.attributes = parentAttrs.map(attr => ({
          attribute: attr.name
        }));
      }
    } else if (product.variantOf) {
      const parentProduct = await this.productRepo.findOne({ where: { sku: product.variantOf } });
      erpPayload.variant_of = parentProduct?.erpnextItemCode || product.variantOf;
      if (product.variantAttributes && product.variantAttributes.length > 0) {
        const variantAttributes = [];
        for (const attr of product.variantAttributes) {
          if (attr.name && attr.value) {
            // Ensure the attribute and its value exist in ERPNext
            try {
              await this.erpnextService['connector'].ensureItemAttributeExists(attr.name, String(attr.value));
            } catch (err: any) {
              this.logger.warn(`Failed to ensure Item Attribute ${attr.name}=${attr.value}: ${err.message}`);
            }
            variantAttributes.push({
              attribute: attr.name,
              attribute_value: String(attr.value)
            });
          }
        }
        if (variantAttributes.length > 0) {
          erpPayload.attributes = variantAttributes;
        }
      }
    }

    // ── Image handling ─────────────────────────────────────────────────────────
    let productImages = product.images;
    if (product.attributes?.images) {
      if (Array.isArray(product.attributes.images) && product.attributes.images.length > 0) {
        productImages = product.attributes.images[0].images || product.attributes.images;
      } else if (product.attributes.images?.images) {
        productImages = product.attributes.images.images;
      } else {
        productImages = product.attributes.images;
      }
    }
    if (productImages && Array.isArray(productImages) && productImages.length > 0) {
      const firstImage = productImages[0] as any;
      const firstImageUrl = firstImage?.link || firstImage;
      erpPayload.image = firstImageUrl;
      erpPayload.custom_thumbnail_image = firstImageUrl;
    } else {
      const baseUrl = process.env.ERPNEXT_BASE_URL || 'https://woodwolf.t3elements.com';
      erpPayload.image = `${baseUrl}/files/WoodwolfLogo.png`;
      erpPayload.custom_thumbnail_image = `${baseUrl}/files/WoodwolfLogo.png`;
    }

    // ── Resolve product type from Amazon attributes ─────────────────────────────
    const rawPayload = product.attributes || {};
    const attrs = rawPayload.attributes || rawPayload;
    const productTypesArr: any[] = rawPayload.productTypes || attrs.productTypes || [];
    const productType: string = (productTypesArr[0]?.productType || product.amazonProductType || '').toUpperCase();

    if (productType) {
      erpPayload.custom_amazon_product_type = productType;
    }

    this.logger.log(`[DYNAMIC-MAP] Product ${product.sku} | productType: "${productType}"`);

    // ── Load field mappings for this product type ───────────────────────────────
    let fieldMappings: FieldMapping[] = [];
    if (productType) {
      fieldMappings = await this.mappingRepo.find({
        where: { marketplace: MarketplaceSource.AMAZON, productType },
      });
      this.logger.log(`[DYNAMIC-MAP] Found ${fieldMappings.length} field mappings for type "${productType}"`);
    }

    // ── Load all ERPNext field definitions into a quick-lookup Map ───────────────
    const erpnextFields = await this.erpnextFieldRepo.find();
    const erpFieldMap = new Map<string, ErpnextProductField>(erpnextFields.map(f => [f.name, f]));

    // ── Cache for child doctype value-field discovery ────────────────────────────
    // Stores { fieldname, fieldtype, linkedDoctype? } per child doctype
    const childValueFieldCache = new Map<string, { fieldname: string; fieldtype: string; linkedDoctype: string | null }>();

    // ── Deep value extractor for Amazon attributes ───────────────────────────────
    const extractAmzValues = (attrsObj: any, key: string): string[] => {
      if (!attrsObj || !key) return [];
      const val = attrsObj[key];
      if (!val) return [];
      let result: string[] = [];
      if (Array.isArray(val)) {
        result = val.map(v => v?.value ?? String(v)).filter(v => v);
      } else if (typeof val === 'object' && val.value !== undefined) {
        result = [String(val.value)];
      } else {
        result = [String(val)];
      }
      return [...new Set(result)];
    };

    // ── Process each dynamic field mapping ─────────────────────────────────────
    const connector = this.erpnextService['connector'];
    for (const mapping of fieldMappings) {
      if (!mapping.erpnextField) {
        continue;
      }

      const amazonValues = extractAmzValues(attrs, mapping.marketplaceField);
      if (amazonValues.length === 0) {
        this.logger.debug(`[DYNAMIC-MAP] No Amazon value for marketplace_field "${mapping.marketplaceField}" → skip`);
        continue;
      }

      // For scalar fields, just take the first value
      const amazonValue = amazonValues[0];

      const erpField = erpFieldMap.get(mapping.erpnextField);
      if (!erpField) {
        // If field not in cache, default to direct string assignment
        this.logger.debug(`[DYNAMIC-MAP] ERPNext field "${mapping.erpnextField}" not found in cache, assigning string directly`);
        erpPayload[mapping.erpnextField] = amazonValue;
        continue;
      }

      this.logger.debug(`[DYNAMIC-MAP] Mapping "${mapping.marketplaceField}" = "${amazonValue}" → "${mapping.erpnextField}" (${erpField.fieldtype})`);

      // ── Map by ERPNext field type ─────────────────────────────────────────────
      switch (erpField.fieldtype) {
        case 'Int':
          erpPayload[mapping.erpnextField] = parseInt(amazonValue, 10) || 0;
          break;

        case 'Float':
        case 'Currency':
        case 'Percent':
          erpPayload[mapping.erpnextField] = parseFloat(amazonValue) || 0;
          break;

        case 'Check':
          erpPayload[mapping.erpnextField] = ['1', 'true', 'yes'].includes(amazonValue.toLowerCase()) ? 1 : 0;
          break;

        case 'Select': {
          // For Select, the `options` field contains newline-separated valid values
          if (erpField.options) {
            const validOptions = erpField.options.split('\\n').map(o => o.trim()).filter(o => o);
            const match = validOptions.find(o => o.toLowerCase() === amazonValue.toLowerCase());
            if (match) {
              erpPayload[mapping.erpnextField] = match;
            } else {
              this.logger.warn(`[DYNAMIC-MAP] Value "${amazonValue}" is not valid for Select field "${mapping.erpnextField}". Valid options: ${validOptions.join(', ')}. Skipping.`);
            }
          } else {
            erpPayload[mapping.erpnextField] = amazonValue;
          }
          break;
        }

        case 'Table':
        case 'Table MultiSelect': {
          const childDoctype = erpField.options;
          if (!childDoctype) {
            this.logger.warn(`[DYNAMIC-MAP] No options (child doctype) set for Table field "${mapping.erpnextField}" — skipping`);
            break;
          }

          // ── Step 1: Discover the value field in the child doctype (cached) ───
          let vfInfo = childValueFieldCache.get(childDoctype);
          if (!vfInfo) {
            const schemaResult = await connector.getDocTypeFields(childDoctype);
            let fieldname = 'name';
            let fieldtype = 'Data';
            let linkedDoctype: string | null = null;
            if (schemaResult.success && schemaResult.data && schemaResult.data.length > 0) {
              const SYSTEM_FIELDS = ['name', 'owner', 'creation', 'modified', 'modified_by', 'docstatus', 'idx', 'parent', 'parentfield', 'parenttype', 'doctype'];
              const firstField = schemaResult.data.find((f: any) => !SYSTEM_FIELDS.includes(f.fieldname));
              if (firstField) {
                fieldname = firstField.fieldname;
                fieldtype = firstField.fieldtype;
                // If the value field is a Link, the Link target is the standalone doctype to list/create in
                linkedDoctype = firstField.fieldtype === 'Link' ? firstField.options : null;
              }
            }
            vfInfo = { fieldname, fieldtype, linkedDoctype };
            childValueFieldCache.set(childDoctype, vfInfo);
            this.logger.debug(
              `[DYNAMIC-MAP] Child doctype "${childDoctype}" → value field: "${fieldname}" (${fieldtype})` +
              (linkedDoctype ? ` → linked to "${linkedDoctype}"` : '')
            );
          }

          const { fieldname: valueField, linkedDoctype } = vfInfo;

          // ── Step 2: Resolve and create table rows for EVERY extracted value ──
          const resolutionDoctype = linkedDoctype || null;
          const tableRows = [];

          for (let amzVal of amazonValues) {
            if (resolutionDoctype) {
              // Truncate to 140 chars because Frappe link fields have a max length of 140
              if (amzVal.length > 140) {
                amzVal = amzVal.substring(0, 140).trim();
              }
              // List existing entries in the LINKED standalone doctype by passing amzVal as a filter
              const existingResult = await connector.getDocTypeEntries(resolutionDoctype, amzVal);
              const existing: any[] = existingResult.success ? (existingResult.data || []) : [];
              const found = existing.find(e =>
                (e.name || '').toLowerCase() === amzVal.toLowerCase()
              );
              if (!found) {
                this.logger.log(`[DYNAMIC-MAP] "${amzVal}" not in "${resolutionDoctype}" — creating...`);
                try {
                  // Some standalone doctypes require 'title', others use 'name' or autonaming
                  // For those with field-based autoname, we must also pass the actual valueField.
                  const createRes = await connector.createDocTypeEntry(resolutionDoctype, {
                    name: amzVal,
                    title: amzVal,
                    [valueField]: amzVal
                  });
                  if (!createRes.success) {
                    this.logger.warn(`[DYNAMIC-MAP] Could not create "${amzVal}" in "${resolutionDoctype}": ${JSON.stringify(createRes.error)}. Skipping field.`);
                    continue;
                  }
                } catch (createErr: any) {
                  this.logger.warn(`[DYNAMIC-MAP] Exception creating "${amzVal}" in "${resolutionDoctype}": ${createErr.message}. Skipping field.`);
                  continue; // Skip this particular value, but try other values
                }
              }
            }

            // We provide a unique 'name' so Frappe doesn't use field-based autoname which causes
            // PRIMARY key collisions across different parent items if values are identical.
            // __islocal: 1 forces Frappe to treat it as a new document in memory during updates.
            const uniqueName = `child-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
            tableRows.push({ doctype: childDoctype, name: uniqueName, __islocal: 1, [valueField]: amzVal });
          }

          if (tableRows.length > 0) {
            erpPayload[mapping.erpnextField] = tableRows;
          }
          break;
        }

        case 'Link':
          // For Link fields, pass the value directly (it's a docname reference)
          erpPayload[mapping.erpnextField] = amazonValue;
          break;

        default:
          // Data, Small Text, Long Text, Text, Text Editor etc — direct string
          erpPayload[mapping.erpnextField] = amazonValue;
          break;
      }
    }

    // ── Explicit Dimension & Weight Mapping ─────────────────────────────────────
    if (rawPayload && rawPayload.attributes) {
      const a = rawPayload.attributes;
      const mapUnit = (u?: string) => {
        if (!u) return u;
        const l = u.toLowerCase();
        if (l === 'centimeters' || l === 'centimeter' || l === 'cm') return 'Centimeter';
        if (l === 'inches' || l === 'inch' || l === 'in') return 'Inch';
        if (l === 'millimeters' || l === 'millimeter' || l === 'mm') return 'Millimeter';
        if (l === 'kilograms' || l === 'kilogram' || l === 'kg') return 'Kg';
        if (l === 'grams' || l === 'gram' || l === 'g') return 'Gram';
        if (l === 'pounds' || l === 'pound' || l === 'lb' || l === 'lbs') return 'Pound';
        return u;
      };

      if (a.item_dimensions && a.item_dimensions.length > 0) {
        const idims = a.item_dimensions[0];
        if (idims.length) erpPayload.custom_item_depth = idims.length.value;
        if (idims.width) erpPayload.custom_item_width = idims.width.value;
        if (idims.height) erpPayload.custom_item_height = idims.height.value;
        const unit = mapUnit(idims.length?.unit || idims.width?.unit || idims.height?.unit);
        if (unit) erpPayload.custom_item_lwh_unit = unit;
      }

      if (a.item_weight && a.item_weight.length > 0) {
        const iw = a.item_weight[0];
        erpPayload.custom_item_weight = iw.value;
        erpPayload.custom_item_weight_unit = mapUnit(iw.unit);
      }

      if (a.item_package_dimensions && a.item_package_dimensions.length > 0) {
        const pdims = a.item_package_dimensions[0];
        if (pdims.length) erpPayload.custom_package_length = pdims.length.value;
        if (pdims.width) erpPayload.custom_package_width = pdims.width.value;
        if (pdims.height) erpPayload.custom_package_height = pdims.height.value;
        const unit = mapUnit(pdims.length?.unit || pdims.width?.unit || pdims.height?.unit);
        if (unit) erpPayload.custom_lwh_unit = unit;
      }

      if (a.item_package_weight && a.item_package_weight.length > 0) {
        const pw = a.item_package_weight[0];
        erpPayload.custom_package_weight = pw.value;
        erpPayload.custom_weight_unit = mapUnit(pw.unit);
      }
    }

    this.logger.log(`[DYNAMIC-MAP] Final ERPNext payload for ${sellerSku}: ${JSON.stringify(erpPayload)}`);

    try {
      // First check if the item already exists in ERPNext
      const checkResult = await connector.getFullItem(sellerSku);

      let itemCode = sellerSku;
      if (checkResult.success) {
        this.logger.log(`Item ${sellerSku} exists in ERPNext. Updating...`);
        const updatedItem = await this.erpnextService.updateItem(sellerSku, erpPayload);
        itemCode = updatedItem.name || updatedItem.item_code || sellerSku;
      } else {
        this.logger.log(`Item ${sellerSku} does not exist in ERPNext. Creating...`);
        const createdItem = await this.erpnextService.createItem(erpPayload);
        itemCode = createdItem.name || createdItem.item_code || sellerSku;
      }

      // Save ERPNext ID back to middleware
      product.erpnextItemCode = itemCode;
      await this.productRepo.save(product);

      // Attach remaining images as File attachments
      if (productImages && Array.isArray(productImages) && productImages.length > 1) {
        this.logger.log(`Attaching ${productImages.length - 1} additional images to Item ${itemCode}...`);
        for (let i = 1; i < productImages.length; i++) {
          const img = productImages[i] as any;
          const url = img?.link || img;
          if (url) {
            try {
              await this.erpnextService.attachFile('Item', itemCode, url);
            } catch (err: any) {
              this.logger.warn(`Failed to attach image ${url} to Item ${itemCode}: ${err.message}`);
            }
          }
        }
      }

      return product;
    } catch (err: any) {
      this.logger.error(`Failed to push ${sellerSku} to ERPNext. Payload: ${JSON.stringify(erpPayload)}`);
      throw err;
    }
  }



  async bulkSyncAmazonToERPNext(): Promise<{ total: number; success: number; failed: number }> {
    this.logger.log('Starting bulk sync of Amazon products to ERPNext...');

    // Fetch all products from Amazon that haven't been synced to ERPNext
    const products = await this.productRepo.find({
      where: {
        isFromAmazon: true,
      }
    });

    if (products.length === 0) {
      this.logger.log('No Amazon products pending sync.');
      return { total: 0, success: 0, failed: 0 };
    }

    let successCount = 0;
    let failedCount = 0;

    // Separate into parents and variants
    const parents = products.filter(p => p.isParent);
    const variantsAndOthers = products.filter(p => !p.isParent);

    // Sync parents first
    for (const parent of parents) {
      try {
        await this.pushToERPNext(parent.id);
        successCount++;
        this.logger.log(`Successfully synced parent item: ${parent.sku}`);
      } catch (err: any) {
        failedCount++;
        this.logger.error(`Failed to sync parent item ${parent.sku}: ${err.message}`);
      }
    }

    // Then sync variants and standalone items
    for (const item of variantsAndOthers) {
      try {
        await this.pushToERPNext(item.id);
        successCount++;
        this.logger.log(`Successfully synced item: ${item.sku}`);
      } catch (err: any) {
        failedCount++;
        this.logger.error(`Failed to sync item ${item.sku}: ${err.message}`);
      }
    }

    return { total: products.length, success: successCount, failed: failedCount };
  }

  async updateProduct(id: string, dto: any): Promise<Product> {
    const product = await this.findById(id);
    if (!product) throw new Error('Product not found');

    // Update local DB fields
    Object.assign(product, dto);
    if (dto.erpnextFields?.custom_amazon_product_type !== undefined) {
      product.amazonProductType = dto.erpnextFields.custom_amazon_product_type;
    }
    await this.productRepo.save(product);

    // Map back to ERPNext schema and push
    if (product.erpnextItemCode) {
      const erpPayload: Record<string, any> = {};

      if (dto.name !== undefined) erpPayload.item_name = dto.name;
      if (dto.status !== undefined) erpPayload.disabled = dto.status === ProductStatus.INACTIVE ? 1 : 0;
      if (dto.brand !== undefined) erpPayload.brand = dto.brand;
      if (dto.category !== undefined) erpPayload.item_group = dto.category;
      if (dto.hsnCode !== undefined) erpPayload.gst_hsn_code = dto.hsnCode;
      if (dto.weight !== undefined) erpPayload.weight_per_unit = dto.weight;
      if (dto.weightUom !== undefined) erpPayload.weight_uom = dto.weightUom;
      if (dto.costPrice !== undefined) erpPayload.standard_rate = dto.costPrice;
      if (dto.sellingPrice !== undefined) erpPayload.custom_amazon_price = dto.sellingPrice; // Note: ERPNext price sync is complex, updating custom fields
      if (dto.mrp !== undefined) erpPayload.custom_mrp = dto.mrp;
      if (dto.upc !== undefined) erpPayload.custom_upc = dto.upc;
      if (dto.customModelName !== undefined) erpPayload.custom_model_name = dto.customModelName;
      if (dto.description !== undefined) erpPayload.description = dto.description;
      if (dto.customAmazon !== undefined) erpPayload.custom_amazon = dto.customAmazon ? 1 : 0;
      if (dto.customFlipkart !== undefined) erpPayload.custom_flipkart = dto.customFlipkart ? 1 : 0;
      if (dto.customAmazonPrice !== undefined) erpPayload.custom_amazon_price = dto.customAmazonPrice;
      if (dto.customFlipkartPrice !== undefined) erpPayload.custom_flipkart_price = dto.customFlipkartPrice;
      if (dto.amazonProductType !== undefined) erpPayload.custom_amazon_product_type = dto.amazonProductType;
      if (dto.erpnextFields?.custom_amazon_product_type !== undefined) erpPayload.custom_amazon_product_type = dto.erpnextFields.custom_amazon_product_type;

      // Merge dynamic erpnextFields
      if (dto.erpnextFields && typeof dto.erpnextFields === 'object') {
        const cleanFields = { ...dto.erpnextFields };

        // Remove system/internal fields that shouldn't be sent back
        const systemFields = ['name', 'creation', 'modified', 'modified_by', 'owner', 'docstatus', 'idx', 'doctype', 'has_variants', 'variant_of', '_user_tags', '_comments', '_assign', '_liked_by'];
        systemFields.forEach(f => delete cleanFields[f]);

        // For standard fields that we usually map from the root DTO, if they were sent inside erpnextFields 
        // (which the admin panel does), we should preserve them in erpPayload before deleting from cleanFields.
        const explicitFields = ['item_name', 'item_code', 'disabled', 'brand', 'item_group', 'gst_hsn_code', 'weight_per_unit', 'weight_uom', 'standard_rate', 'custom_amazon_price', 'custom_mrp', 'custom_upc', 'custom_model_name', 'description', 'custom_amazon', 'custom_flipkart', 'custom_flipkart_price', 'custom_amazon_product_type'];

        explicitFields.forEach(f => {
          if (cleanFields[f] !== undefined && erpPayload[f] === undefined) {
            erpPayload[f] = cleanFields[f];
          }
          delete cleanFields[f];
        });

        Object.assign(erpPayload, cleanFields);

        // Also update local attributes jsonb so it reflects immediately
        product.attributes = {
          ...product.attributes,
          ...cleanFields,
        };
        await this.productRepo.save(product);
      }

      if (Object.keys(erpPayload).length > 0) {
        await this.erpnextService.updateItem(product.erpnextItemCode, erpPayload);
      }
    }

    return product;
  }

  async delete(id: string): Promise<void> {
    const product = await this.findById(id);
    if (!product) throw new Error('Product not found');

    // Attempt to delete from ERPNext
    const erpnextItemCode = product.erpnextItemCode || product.sku;
    if (erpnextItemCode) {
      try {
        await this.erpnextService.deleteItem(erpnextItemCode);
        this.logger.log(`Deleted item ${erpnextItemCode} from ERPNext`);
      } catch (err: any) {
        this.logger.warn(`Failed to delete item ${erpnextItemCode} from ERPNext (it may not exist or has linked documents): ${err.message}`);
      }
    }

    // Attempt to delete from Amazon
    if (product.sku) {
      try {
        await this.amazonConnector.deleteItem(product.sku);
        this.logger.log(`Deleted item ${product.sku} from Amazon`);
      } catch (err: any) {
        this.logger.warn(`Failed to delete item ${product.sku} from Amazon: ${err.message}`);
      }
    }

    // Finally, remove from local DB
    await this.productRepo.remove(product);
  }

  async updateStatus(id: string, status: ProductStatus): Promise<Product> {
    const product = await this.findById(id);
    if (!product) throw new Error('Product not found');

    product.status = status;
    await this.productRepo.save(product);

    if (product.erpnextItemCode) {
      await this.erpnextService.updateItem(product.erpnextItemCode, {
        disabled: status === ProductStatus.INACTIVE ? 1 : 0
      });
    }

    return product;
  }

  // ─── Sync Triggers ────────────────────────────────────────────────────────

  /**
   * Triggers a product sync job:
   * 1. Fetches from ERPNext
   * 2. Upserts into local products table
   * 3. Optionally pushes to marketplace(s)
   */
  async triggerSync(source?: MarketplaceSource, skus?: string[]): Promise<string> {
    const job = await this.productsQueue.add(
      JOB_NAMES.SYNC_PRODUCTS,
      { source, skus },
      { ...QUEUE_DEFAULT_OPTIONS, jobId: uuidv4() },
    );

    // Synchronously insert the DB record so it immediately appears in the UI
    // Using insert instead of upsert so we don't accidentally overwrite a COMPLETED status
    // if the job finished instantly before this line executes.
    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.PRODUCTS,
        jobName: JOB_NAMES.SYNC_PRODUCTS,
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: job.opts?.attempts || 3,
      });
    } catch (e) {
      this.logger.error(`Failed to insert QueueJob record: ${e.message}`, e.stack);
    }

    this.logger.log(`Product sync job queued: ${job.id}`);
    return String(job.id);
  }

  async triggerFetchFromERPNext(sku?: string): Promise<string> {
    const job = await this.productsQueue.add(
      JOB_NAMES.FETCH_PRODUCTS,
      { sku },
      { ...QUEUE_DEFAULT_OPTIONS, jobId: uuidv4() },
    );

    // Synchronously insert the DB record so it immediately appears in the UI
    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.PRODUCTS,
        jobName: JOB_NAMES.FETCH_PRODUCTS,
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: job.opts?.attempts || 3,
      });
    } catch (e) {
      this.logger.error(`Failed to insert QueueJob record: ${e.message}`, e.stack);
    }

    this.logger.log(`Fetch products from ERPNext job queued: ${job.id}`);
    return String(job.id);
  }

  async triggerAmazonFetch(): Promise<string> {
    const job = await this.productsQueue.add(
      JOB_NAMES.FETCH_AMAZON_PRODUCTS,
      {},
      { ...QUEUE_DEFAULT_OPTIONS, jobId: uuidv4() },
    );

    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.PRODUCTS,
        jobName: JOB_NAMES.FETCH_AMAZON_PRODUCTS,
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: job.opts?.attempts || 3,
      });
    } catch (e) {
      this.logger.error(`Failed to insert QueueJob record: ${e.message}`, e.stack);
    }

    this.logger.log(`Fetch products from Amazon job queued: ${job.id}`);
    return String(job.id);
  }

  // ─── ERPNext Sync ─────────────────────────────────────────────────────────

  /**
   * Fetches products from ERPNext and upserts into the local DB.
   */
  async syncFromERPNext(): Promise<{ total: number; upserted: number }> {
    const result = await this.erpnextService['connector']?.fetchProducts({ pageSize: 500 });
    if (!result?.success) {
      this.logger.warn('No products fetched from ERPNext');
      return { total: 0, upserted: 0 };
    }

    const products = result.data?.items || [];
    let upserted = 0;

    for (const p of products) {
      try {
        await this.productRepo.upsert(
          {
            sku: p.sku,
            erpnextItemCode: p.sku,
            name: p.name,
            description: p.description,
            category: p.category,
            brand: p.brand,
            thumbnailUrl: p.thumbnailUrl || (p.images && p.images.length > 0 ? p.images[0] : null),
            images: p.images || [],
            mrp: p.mrp || 0,
            sellingPrice: p.sellingPrice || 0,
            hsnCode: p.hsnCode,
            gstRate: p.gstRate || 18,
            weight: p.weight,
            upc: p.upc || null,
            amazonAsin: p.amazonAsin || null,
            amazonProductType: p.amazonProductType || null,
            status: ProductStatus.ACTIVE,
            customItemTypeName: p.customItemTypeName || null,
            customModelName: p.customModelName || null,
            customStyle: p.customStyle || null,
            customNumberOfItems: p.customNumberOfItems || null,
            customColor: p.customColor || null,
            customNumberOfPieces: p.customNumberOfPieces || null,
            customModelNumber: p.customModelNumber || null,
            customManufacturerContactInfo: p.customManufacturerContactInfo || null,
            customRequiredAssembly: p.customRequiredAssembly !== undefined ? p.customRequiredAssembly : null,
            customDepth: p.customDepth !== undefined ? p.customDepth : null,
            customWidth: p.customWidth !== undefined ? p.customWidth : null,
            customHeight: p.customHeight !== undefined ? p.customHeight : null,
            customNumberOfPacks: p.customNumberOfPacks !== undefined ? p.customNumberOfPacks : null,
            customExternalProductInformation: p.customExternalProductInformation || null,
            customShelfThickness: p.customShelfThickness !== undefined ? p.customShelfThickness : null,
            customAssemblyInstructions: p.customAssemblyInstructions || null,
            customUnit: p.customUnit || null,
            customItemShape: p.customItemShape || null,
            customShelfType: p.customShelfType || null,
            customNumberOfShelves: p.customNumberOfShelves || null,
            customMountingType: p.customMountingType || null,
            customFinishType: p.customFinishType || null,
            customSelectMaterial: p.customSelectMaterial || null,
            customIncludedComponents: p.customIncludedComponents || null,
            customAmazonBulletPoint: p.customAmazonBulletPoint || null,
            customPackerContactInformation: p.customPackerContactInformation || null,
            customSpecificUsesForProduct: p.customSpecificUsesForProduct || null,
            customRecommendedUsesForProduct: p.customRecommendedUsesForProduct || null,
            customRoomType: p.customRoomType || null,
            customSpecialFeature: p.customSpecialFeature || null,
            customCareInstructions: p.customCareInstructions || null,
            attributes: p.attributes || p.rawPayload || null,
            lastSyncedAt: new Date(),
          },
          ['sku'],
        );
        upserted++;
      } catch (err) {
        this.logger.error(`Failed to upsert product ${p.sku}: ${err.message}`);
      }
    }

    this.logger.log(`Products synced from ERPNext: ${upserted}/${products.length}`);
    return { total: products.length, upserted };
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(): Promise<Record<string, number>> {
    const total = await this.productRepo.count();
    const active = await this.productRepo.count({ where: { status: ProductStatus.ACTIVE } });
    const inactive = await this.productRepo.count({ where: { status: ProductStatus.INACTIVE } });
    const amazonListed = await this.productRepo.count({ where: { isAmazonListed: true } });
    const flipkartListed = await this.productRepo.count({ where: { isFlipkartListed: true } });

    return { total, active, inactive, amazonListed, flipkartListed };
  }
}
