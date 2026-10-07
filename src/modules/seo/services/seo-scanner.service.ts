import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance } from 'axios';
import { SeoIssue, SeoDefectType, SeoSeverity } from '../../../database/entities/seo-issue.entity';
import { ErpItem } from '../../../database/entities/erp-item.entity';

export interface RawCatalogItem {
  name: string;
  item_code: string;
  item_name: string;
  item_group?: string;
  brand?: string;
  standard_rate?: number;
  valuation_rate?: number;
  selling_price?: number;
  image?: string;
  parent_image?: string;
  description?: string;
  custom_short_description?: string;
  custom_meta_title?: string;
  custom_meta_description?: string;
  custom_meta_keywords?: string;
  custom_index_this_page?: number;
  custom_follow_this_page?: number;
  custom_dimensions?: string;
  custom_width?: number | string;
  custom_height?: number | string;
  custom_depth?: number | string;
  custom_length?: number | string;
  custom_unit?: string;
  custom_material?: string;
  custom_mounting?: string;
  custom_compartments?: number | string;
  custom_weight?: number | string;
  has_variants?: number;
  variant_of?: string;
  disabled?: number;
  creation?: string;
  modified?: string;
  route?: string;
}

export const BLOCKLIST_PATTERNS = [
  /\btitle come here\b/i,
  /\bproduct detail\b/i,
  /\binkreatix\b/i,
  /\becomus\b/i,
  /\bfashion template\b/i,
  /\btheme template\b/i,
  /\bdemo title\b/i,
  /\bsample product\b/i,
];

export function normalizeTitleSlug(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function isValidWoodwolfSku(sku: string, brand?: string): boolean {
  if (!sku || typeof sku !== 'string') return false;
  const trimmed = sku.trim().toUpperCase();
  // SKUs cannot contain spaces or newlines (that indicates an item description or OCR raw text)
  if (/\s/.test(trimmed) || trimmed.length > 50 || trimmed.length < 3) return false;
  if (trimmed.startsWith('WW-') || trimmed.startsWith('WOODWOLF-')) return true;
  if (brand && (brand.toLowerCase().includes('woodwolf') || brand.toLowerCase().includes('wood wolf')) && !/\s/.test(trimmed)) {
    return true;
  }
  return false;
}

@Injectable()
export class SeoScannerService {
  private readonly logger = new Logger(SeoScannerService.name);
  private httpClient: AxiosInstance | null = null;
  private readonly siteBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(SeoIssue)
    private readonly issueRepo: Repository<SeoIssue>,
    @InjectRepository(ErpItem)
    private readonly itemRepo: Repository<ErpItem>,
  ) {
    this.siteBaseUrl = (
      this.configService.get<string>('NEXT_PUBLIC_SITE_URL') ||
      'https://woodwolff.com'
    ).replace(/\/+$/, '');
    this.initHttpClient();
  }

  private initHttpClient() {
    const url =
      this.configService.get<string>('ERPNEXT_URL') ||
      this.configService.get<string>('ERPNEXT_BASE_URL');
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
        timeout: 20000,
      });
      this.logger.log(`SeoScannerService: Connected to Woodwolf ERPNext live API host: ${url}`);
    } else {
      this.logger.log('SeoScannerService: ERPNext credentials missing or running in local database cache mode.');
    }
  }

  /**
   * Canonical URL builder
   */
  private getCanonicalUrl(item: RawCatalogItem): string {
    const slug = normalizeTitleSlug(item.custom_meta_title || item.item_name || item.name);
    return `${this.siteBaseUrl}/product/${slug}`;
  }

  /**
   * Fetches items directly from ERPNext DocType Item in paginated batches
   * and resolves live selling prices from Item Price doctype
   */
  async fetchCatalogItems(): Promise<RawCatalogItem[]> {
    const allFetchedItems: RawCatalogItem[] = [];

    if (this.httpClient) {
      try {
        const fields = JSON.stringify([
          'name',
          'item_code',
          'item_name',
          'item_group',
          'brand',
          'standard_rate',
          'valuation_rate',
          'image',
          'description',
          'custom_short_description',
          'custom_slug',
          'custom_mrp',
          'custom_compare_at_price',
          'is_stock_item',
          'stock_uom',
          'has_variants',
          'variant_of',
          'disabled',
          'creation',
          'modified',
        ]);

        let page = 0;
        const pageSize = 100;
        let hasMore = true;

        while (hasMore && page < 50) {
          const response = await this.httpClient.get('/api/resource/Item', {
            params: {
              fields,
              filters: JSON.stringify([
                ['disabled', '=', 0],
                ['has_variants', '=', 0],
                ['brand', 'like', '%Woodwolf%'],
              ]),
              limit_start: page * pageSize,
              limit_page_length: pageSize,
              order_by: 'modified desc',
            },
          });

          const itemsBatch = response.data?.data || [];
          if (!Array.isArray(itemsBatch) || itemsBatch.length === 0) {
            hasMore = false;
            break;
          }

          // Fetch Item Price for the batch from ERPNext Standard Selling list
          const itemCodes = itemsBatch.map((i: any) => i.item_code || i.name).filter(Boolean);
          const priceMap: Record<string, number> = {};

          if (itemCodes.length > 0) {
            try {
              const priceRes = await this.httpClient.get('/api/resource/Item Price', {
                params: {
                  fields: JSON.stringify(['item_code', 'price_list_rate']),
                  filters: JSON.stringify([
                    ['selling', '=', 1],
                    ['price_list', '=', 'Standard Selling'],
                    ['item_code', 'in', itemCodes],
                  ]),
                  limit_page_length: itemCodes.length,
                },
              });
              if (Array.isArray(priceRes.data?.data)) {
                for (const p of priceRes.data.data) {
                  priceMap[p.item_code] = Number(p.price_list_rate || 0);
                }
              }
            } catch (err: any) {
              this.logger.debug(`Item Price fetch skipped: ${err.message}`);
            }
          }

          for (const item of itemsBatch) {
            if (item.disabled === 1 || item.has_variants === 1) {
              continue;
            }

            // STRICT BRAND FILTER: Only scan genuine Woodwolf brand items
            const brandName = (item.brand || '').toLowerCase().trim();
            if (!brandName.includes('woodwolf')) {
              continue; // Ignore any other brand
            }

            const code = (item.item_code || item.name || '').trim();
            if (!code) {
              continue;
            }

            // Attach resolved live selling price if standard_rate is 0
            if ((!item.standard_rate || item.standard_rate === 0) && priceMap[code]) {
              item.standard_rate = priceMap[code];
            }

            allFetchedItems.push(item);
          }

          if (itemsBatch.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        }

        if (allFetchedItems.length > 0) {
          this.logger.log(`Fetched ${allFetchedItems.length} live Woodwolf catalog items across ${page + 1} pages from ERPNext.`);
          return allFetchedItems;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to fetch items from live ERPNext API (${err.message}). Checking local DB sync.`);
      }
    }

    // Return only genuinely synced Woodwolf items from PostgreSQL database if available
    const localItems = await this.itemRepo.find();
    if (localItems && localItems.length > 0) {
      const woodwolfOnlyLocal = localItems.filter((i) => {
        const code = (i.item_code || '').trim();
        return isValidWoodwolfSku(code, 'Woodwolf');
      });

      if (woodwolfOnlyLocal.length > 0) {
        return woodwolfOnlyLocal.map((i) => ({
          name: i.item_code,
          item_code: i.item_code,
          item_name: i.item_name,
          item_group: i.item_group || 'Uncategorized',
          brand: 'Woodwolf',
          description: i.description || '',
          image: '',
          standard_rate: Number(i.standard_rate || 0),
          disabled: 0,
        }));
      }
    }

    // No dummy or fallback data - return empty array
    return [];
  }

  /**
   * Executes the 8 Deterministic Heuristic Tests and performs smart database merging
   */
  async runSweep(): Promise<{
    totalScanned: number;
    issuesFound: number;
    newIssues: number;
    autoResolved: number;
  }> {
    const items = await this.fetchCatalogItems();
    const existingIssues = await this.issueRepo.find();
    const existingMap = new Map<string, SeoIssue>();
    for (const issue of existingIssues) {
      existingMap.set(`${issue.sku}::${issue.defect_type}`, issue);
    }

    const detectedDefects: Array<{
      sku: string;
      product_name: string;
      category: string;
      live_url: string;
      defect_type: SeoDefectType;
      severity: SeoSeverity;
      defect_details: string;
    }> = [];

    // Map for slug collision detection (slug -> sku)
    const slugMap = new Map<string, string>();

    // Pass 1: Build slug registry for collision check
    for (const item of items) {
      if (item.disabled === 1 || item.has_variants === 1) continue;
      const sku = item.item_code || item.name;
      const titleSlug = normalizeTitleSlug(item.custom_meta_title || item.item_name || item.name);
      if (titleSlug && !slugMap.has(titleSlug)) {
        slugMap.set(titleSlug, sku);
      }
    }

    const dimensionCategories = [
      'shelf',
      'rack',
      'furniture',
      'stand',
      'table',
      'cabinet',
      'hanger',
      'organizer',
      'storage',
    ];

    // Pass 2: Execute 8 Deterministic Tests for each item
    for (const item of items) {
      if (item.disabled === 1 || item.has_variants === 1) continue;

      const sku = item.item_code || item.name;
      const name = item.item_name || item.name || sku;
      const category = item.item_group || 'Furniture & Storage';
      const liveUrl = this.getCanonicalUrl(item);
      const titleSlug = normalizeTitleSlug(item.custom_meta_title || name);

      // Clean stripped description for tests
      const cleanDesc = (item.description || item.custom_short_description || '')
        .replace(/<[^>]*>?/gm, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // TEST 1: Price Validity Check (INVALID_PRICE)
      const price = Number(
        item.selling_price ||
        item.standard_rate ||
        (item as any).custom_mrp ||
        (item as any).custom_compare_at_price ||
        item.valuation_rate ||
        0
      );
      if (isNaN(price) || price <= 0) {
        detectedDefects.push({
          sku,
          product_name: name,
          category,
          live_url: liveUrl,
          defect_type: 'INVALID_PRICE',
          severity: 'CRITICAL',
          defect_details: 'Price is ₹0.00 or missing in ERP standard rate list.',
        });
      }

      // TEST 2: Product Image Check (MISSING_IMAGE)
      const rawImage = (item.image || item.parent_image || '').trim().toLowerCase();
      const isMissingImage =
        !rawImage ||
        rawImage.includes('placeholder') ||
        rawImage.includes('default') ||
        rawImage.includes('dummy') ||
        rawImage.includes('sample') ||
        rawImage.endsWith('.svg');

      if (isMissingImage) {
        detectedDefects.push({
          sku,
          product_name: name,
          category,
          live_url: liveUrl,
          defect_type: 'MISSING_IMAGE',
          severity: 'HIGH',
          defect_details: 'No real product image uploaded (missing or using placeholder).',
        });
      }

      // TEST 3: Description Completeness Check (MISSING_DESCRIPTION / THIN_DESCRIPTION)
      if (cleanDesc.length === 0) {
        detectedDefects.push({
          sku,
          product_name: name,
          category,
          live_url: liveUrl,
          defect_type: 'THIN_DESCRIPTION',
          severity: 'HIGH',
          defect_details: 'Product description is completely empty in ERP.',
        });
      } else if (cleanDesc.length < 100) {
        detectedDefects.push({
          sku,
          product_name: name,
          category,
          live_url: liveUrl,
          defect_type: 'THIN_DESCRIPTION',
          severity: 'MEDIUM',
          defect_details: `Thin product description (${cleanDesc.length} characters < 100 char minimum).`,
        });
      }

      // TEST 4: Demo / Blocklist Copy Detection (BLOCKLIST_CONTENT)
      const corpusToCheck = `${item.item_name || ''} ${item.description || ''} ${item.custom_meta_title || ''} ${item.custom_meta_description || ''}`;
      for (const pattern of BLOCKLIST_PATTERNS) {
        const match = corpusToCheck.match(pattern);
        if (match) {
          detectedDefects.push({
            sku,
            product_name: name,
            category,
            live_url: liveUrl,
            defect_type: 'BLOCKLIST_CONTENT',
            severity: 'CRITICAL',
            defect_details: `Contains legacy demo/template text matching pattern: ${match[0]}`,
          });
          break;
        }
      }

      // TEST 5: Furniture & Storage Dimensions Check (MISSING_DIMENSIONS)
      const lowerCat = category.toLowerCase();
      const isDimensionCategory = dimensionCategories.some((c) => lowerCat.includes(c));
      if (isDimensionCategory) {
        const hasDim =
          Boolean(item.custom_dimensions) ||
          Boolean(item.custom_width) ||
          Boolean(item.custom_height) ||
          Boolean(item.custom_length) ||
          Boolean(item.custom_depth);

        if (!hasDim) {
          detectedDefects.push({
            sku,
            product_name: name,
            category,
            live_url: liveUrl,
            defect_type: 'MISSING_DIMENSIONS',
            severity: 'MEDIUM',
            defect_details: 'Furniture/storage category item missing dimension specifications (LxWxH or size specs).',
          });
        }
      }

      // TEST 6: Title Tag Length SERP Budget Check (OVER_BUDGET_TITLE)
      const targetTitle = (item.custom_meta_title || name || '').trim();
      if (targetTitle.length > 60) {
        detectedDefects.push({
          sku,
          product_name: name,
          category,
          live_url: liveUrl,
          defect_type: 'OVER_BUDGET_TITLE',
          severity: 'MEDIUM',
          defect_details: `Custom SEO title is ${targetTitle.length} characters (exceeds Google SERP 60-character budget).`,
        });
      }

      // TEST 7: Duplicate Title / Slug Collision Check (DUPLICATE_TITLE)
      const registeredSku = slugMap.get(titleSlug);
      if (registeredSku && registeredSku !== sku) {
        detectedDefects.push({
          sku,
          product_name: name,
          category,
          live_url: liveUrl,
          defect_type: 'DUPLICATE_TITLE',
          severity: 'HIGH',
          defect_details: `Duplicate title slug '${titleSlug}' collided with SKU: ${registeredSku}`,
        });
      }

      // TEST 8: Canonical & URL Resolution Check (CANONICAL_MISMATCH)
      if (item.custom_index_this_page === 0) {
        detectedDefects.push({
          sku,
          product_name: name,
          category,
          live_url: liveUrl,
          defect_type: 'CANONICAL_MISMATCH',
          severity: 'MEDIUM',
          defect_details: 'Canonical indexing disabled (custom_index_this_page = 0) in ERP.',
        });
      }
    }

    let newIssues = 0;
    let autoResolved = 0;
    const detectedKeys = new Set<string>();

    // 🗄️ Smart Merging Logic on New Sweep:
    for (const defect of detectedDefects) {
      const key = `${defect.sku}::${defect.defect_type}`;
      detectedKeys.add(key);

      const existing = existingMap.get(key);
      if (existing) {
        // If SKU already exists in DB: Preserve id, status (if SNOOZED and date not expired), snoozed_until, snooze_reason, owner, and firstSeen
        if (existing.status === 'SNOOZED' && existing.snoozed_until) {
          if (new Date() > new Date(existing.snoozed_until)) {
            existing.status = 'OPEN';
            existing.snoozed_until = null;
            existing.snooze_reason = null;
          }
        }
        existing.product_name = defect.product_name;
        existing.category = defect.category;
        existing.live_url = defect.live_url;
        existing.defect_details = defect.defect_details;
        existing.severity = defect.severity;
        existing.updated_at = new Date();
        await this.issueRepo.save(existing);
      } else {
        // If SKU is new: Insert new record with status: 'OPEN', firstSeen = NOW()
        const newIssue = this.issueRepo.create({
          sku: defect.sku,
          product_name: defect.product_name,
          category: defect.category,
          live_url: defect.live_url,
          defect_type: defect.defect_type,
          severity: defect.severity,
          status: 'OPEN',
          defect_details: defect.defect_details,
          owner: 'Shubham',
        });
        await this.issueRepo.save(newIssue);
        newIssues++;
      }
    }

    // Auto-resolve fixed issues that no longer fail any tests
    for (const [key, issue] of existingMap.entries()) {
      if (!detectedKeys.has(key) && issue.status === 'OPEN') {
        issue.status = 'RESOLVED';
        issue.resolved_at = new Date();
        issue.resolved_by = 'Automated ERPNext Sweep';
        await this.issueRepo.save(issue);
        autoResolved++;
      }
    }

    return {
      totalScanned: items.length,
      issuesFound: detectedDefects.length,
      newIssues,
      autoResolved,
    };
  }
}



