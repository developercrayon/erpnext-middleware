import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { SeoIssue, SeoSeverity, SeoDefectType, SeoStatus } from '../../../database/entities/seo-issue.entity';
import { SeoTask } from '../../../database/entities/seo-task.entity';
import { SeoSignoff } from '../../../database/entities/seo-signoff.entity';
import { SeoAnalyticsService } from './seo-analytics.service';
import {
  SeoDashboardData,
  SeoDashboardSummary,
  SeoIssueDto,
} from '../interfaces/seo.interface';
import {
  UpdateIssueStatusDto,
  CreateSeoTaskDto,
  UpdateSeoTaskDto,
  ToggleSignoffDto,
} from '../dto/seo.dto';

export { SeoIssue as SeoIssueEntity };

@Injectable()
export class SeoService implements OnModuleInit {
  private readonly logger = new Logger(SeoService.name);
  private readonly siteUrl = 'https://woodwolff.com';

  constructor(
    @InjectRepository(SeoIssue)
    private readonly issueRepo: Repository<SeoIssue>,
    @InjectRepository(SeoTask)
    private readonly taskRepo: Repository<SeoTask>,
    @InjectRepository(SeoSignoff)
    private readonly signoffRepo: Repository<SeoSignoff>,
    private readonly analyticsService: SeoAnalyticsService,
  ) {}

  async onModuleInit() {
    // Check if initial scan is needed
    const count = await this.issueRepo.count();
    if (count === 0) {
      this.logger.log('SeoService: No issues in database, initiating first live ERPNext sync.');
      await this.syncErpCatalog();
      await this.seedInitialTasks();
      await this.seedInitialSignoffs();
    }
  }

  /** Single source of truth for Title Slug creation */
  private normalizeTitleSlug(name?: string | null): string {
    if (!name) return '';
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Directly fetch live products from ERPNext /api/resource/Item
   * ZERO MOCK DATA - Direct REST calls with full logging
   */
  async syncErpCatalog(): Promise<{
    success: boolean;
    totalScanned: number;
    issuesFound: number;
    newIssues: number;
    autoResolved: number;
  }> {
    const erpUrl = (
      process.env.ERPNEXT_URL ||
      process.env.ERPNEXT_BASE_URL ||
      'https://woodwolf.t3elements.com'
    ).replace(/\/+$/, '');
    const apiKey = process.env.ERPNEXT_API_KEY || 'f1b451cdef41ad5';
    const apiSecret = process.env.ERPNEXT_API_SECRET || 'ca3c3fb2bd56549';

    this.logger.log(`[ERP Sync] Connecting to ERPNext at: ${erpUrl}`);

    if (!erpUrl || !apiKey || !apiSecret) {
      this.logger.error('[ERP Sync] Missing ERPNext credentials in .env!');
      throw new Error(
        'ERPNext API credentials (ERPNEXT_URL/ERPNEXT_BASE_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET) missing.',
      );
    }

    const headers = {
      Authorization: `token ${apiKey}:${apiSecret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    // Whitelist of valid fields permitted in ERPNext Item list queries
    const ITEM_FIELDS = [
      'name',
      'item_code',
      'item_name',
      'item_group',
      'disabled',
      'brand',
      'valuation_rate',
      'standard_rate',
      'image',
      'description',
      'has_variants',
      'variant_of',
      'custom_slug',
      'custom_mrp',
      'custom_compare_at_price',
      'custom_short_description',
      'is_stock_item',
      'stock_uom',
      'modified',
      'creation',
    ];

    let page = 0;
    const pageSize = 500;
    let hasMore = true;
    const allDetectedDefects: Array<{
      sku: string;
      productName: string;
      category: string;
      url: string;
      defectType: SeoDefectType;
      severity: SeoSeverity;
      details: string;
    }> = [];
    const seenTitleMap = new Map<string, string>();
    let totalItemsProcessed = 0;

    while (hasMore && page < 20) {
      const filterArray: any[][] = [
        ['disabled', '=', 0],
        ['has_variants', '=', 0],
        ['brand', 'like', '%Woodwolf%'],
      ];

      const params = new URLSearchParams({
        fields: JSON.stringify(ITEM_FIELDS),
        filters: JSON.stringify(filterArray),
        limit_page_length: String(pageSize),
        limit_start: String(page * pageSize),
        order_by: 'modified desc',
      });

      const requestUrl = `${erpUrl}/api/resource/Item?${params.toString()}`;
      this.logger.log(`[ERP Sync] Fetching batch ${page + 1}: ${requestUrl}`);

      try {
        const response = await axios.get(requestUrl, { headers, timeout: 20000 });
        const items = response.data?.data || [];

        this.logger.log(
          `[ERP Sync] Batch ${page + 1} returned ${items.length} live items from ERPNext (HTTP ${response.status}).`,
        );

        if (!Array.isArray(items) || items.length === 0) {
          hasMore = false;
          break;
        }

        totalItemsProcessed += items.length;

        // Fetch real selling prices from Item Price doctype for items in this batch
        const itemCodes = items.map((i: any) => i.item_code || i.name).filter(Boolean);
        const priceMap: Record<string, number> = {};

        if (itemCodes.length > 0) {
          try {
            const priceRes = await axios.get(`${erpUrl}/api/resource/Item Price`, {
              headers,
              params: {
                fields: JSON.stringify(['item_code', 'price_list_rate']),
                filters: JSON.stringify([
                  ['selling', '=', 1],
                  ['price_list', '=', 'Standard Selling'],
                  ['item_code', 'in', itemCodes],
                ]),
                limit_page_length: itemCodes.length,
              },
              timeout: 10000,
            });
            if (Array.isArray(priceRes.data?.data)) {
              for (const p of priceRes.data.data) {
                priceMap[p.item_code] = Number(p.price_list_rate || 0);
              }
            }
          } catch (err: any) {
            this.logger.debug(`[ERP Sync] Item Price fetch skipped: ${err.message}`);
          }
        }

        for (const item of items) {
          if (item.disabled || item.has_variants) continue;

          // STRICT BRAND FILTER: Only scan genuine Woodwolf brand items
          const brandName = (item.brand || '').toLowerCase().trim();
          if (!brandName.includes('woodwolf')) {
            continue; // Ignore any other brand
          }

          const rawName = (item.item_name || item.name || '').trim();
          const sku = (item.item_code || item.name || '').trim();
          if (!sku) continue;

          const titleSlug = this.normalizeTitleSlug(rawName) || sku;
          const pdpUrl = `${this.siteUrl}/product/${titleSlug}`;
          const category = item.item_group || 'Uncategorized';

          const issueTypes: string[] = [];
          const details: string[] = [];

          // 1. Invalid / ₹0 Price Check
          let price = Number(item.standard_rate || item.valuation_rate || 0);
          if (priceMap[sku] && priceMap[sku] > 0) {
            price = priceMap[sku];
          }

          if (isNaN(price) || price <= 0) {
            issueTypes.push('INVALID_PRICE');
            details.push('Price is ₹0.00 or missing in ERP master');
          }

          // 2. Missing / Broken Image Check
          const rawImg = (item.image || '').trim();
          if (
            !rawImg ||
            rawImg.includes('placeholder') ||
            rawImg.includes('default') ||
            rawImg === 'placeholder.png'
          ) {
            issueTypes.push('MISSING_IMAGE');
            details.push('No real product image uploaded in ERP');
          }

          // 3. Thin / Missing Description
          const cleanDesc = (item.description || item.custom_short_description || '')
            .replace(/<[^>]*>?/gm, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (!cleanDesc) {
            issueTypes.push('MISSING_DESCRIPTION');
            details.push('Product description is completely empty in ERP');
          } else if (cleanDesc.length < 100) {
            issueTypes.push('THIN_DESCRIPTION');
            details.push(`Description too short (${cleanDesc.length} chars < 100 char threshold)`);
          }

          // 4. Duplicate Title Slug Detection across catalog
          if (titleSlug) {
            if (seenTitleMap.has(titleSlug)) {
              const collidingSku = seenTitleMap.get(titleSlug);
              issueTypes.push('DUPLICATE_TITLE');
              details.push(`Duplicate title slug shared with SKU: ${collidingSku}`);
            } else {
              seenTitleMap.set(titleSlug, sku);
            }
          }

          // 5. Title Length Check (> 60 characters)
          if (rawName.length > 60) {
            issueTypes.push('OVER_BUDGET_TITLE');
            details.push(`Title length is ${rawName.length} chars (recommended <= 60 chars)`);
          }

          // If product has issues, push exactly 1 aggregated record for this product
          // Push individual defects for each issue type to avoid varchar(50) database constraint overflow
          if (issueTypes.length > 0) {
            issueTypes.forEach((issueType, idx) => {
              let severity: SeoSeverity = 'MEDIUM';
              if (issueType === 'INVALID_PRICE' || issueType === 'BLOCKLIST_CONTENT') {
                severity = 'CRITICAL';
              } else if (issueType === 'MISSING_IMAGE' || issueType === 'DUPLICATE_TITLE') {
                severity = 'HIGH';
              }

              allDetectedDefects.push({
                sku,
                productName: rawName || sku,
                category,
                url: pdpUrl,
                defectType: issueType as any,
                severity,
                details: details[idx] || '',
              });
            });
          }
        }

        if (items.length < pageSize) {
          hasMore = false;
        } else {
          page++;
        }
      } catch (err: any) {
        this.logger.error(
          `[ERP Sync] Error on batch ${page + 1}: ${err.response?.data?.message || err.message}`,
        );
        break;
      }
    }

    this.logger.log(
      `[ERP Sync] Total scanned: ${totalItemsProcessed} items. Total products with defects: ${allDetectedDefects.length}`,
    );

    // Save/Merge with Database (1 SKU = 1 Row)
    const { newIssues, autoResolved } = await this.saveIssuesToDatabase(allDetectedDefects);

    return {
      success: true,
      totalScanned: totalItemsProcessed,
      issuesFound: allDetectedDefects.length,
      newIssues,
      autoResolved,
    };
  }

  private async saveIssuesToDatabase(
    defects: Array<{
      sku: string;
      productName: string;
      category: string;
      url: string;
      defectType: SeoDefectType;
      severity: SeoSeverity;
      details: string;
    }>,
  ): Promise<{ newIssues: number; autoResolved: number }> {
    const existingIssues = await this.issueRepo.find();
    const existingMap = new Map<string, SeoIssue>();
    for (const item of existingIssues) {
      existingMap.set(`${item.sku}::${item.defect_type}`, item);
    }

    let newIssues = 0;
    let autoResolved = 0;
    const detectedKeys = new Set<string>();

    for (const defect of defects) {
      const key = `${defect.sku}::${defect.defectType}`;
      detectedKeys.add(key);

      const existing = existingMap.get(key);
      if (existing) {
        existing.product_name = defect.productName;
        existing.category = defect.category;
        existing.live_url = defect.url;
        existing.defect_type = defect.defectType;
        existing.defect_details = defect.details;
        existing.severity = defect.severity;
        existing.updated_at = new Date();
        await this.issueRepo.save(existing);
      } else {
        const newIssue = this.issueRepo.create({
          sku: defect.sku,
          product_name: defect.productName,
          category: defect.category,
          live_url: defect.url,
          defect_type: defect.defectType,
          severity: defect.severity,
          status: 'OPEN',
          defect_details: defect.details,
          owner: 'Shubham',
        });
        await this.issueRepo.save(newIssue);
        newIssues++;
      }
    }

    // Auto-resolve fixed issues
    for (const [key, issue] of existingMap.entries()) {
      if (!detectedKeys.has(key) && issue.status === 'OPEN') {
        issue.status = 'RESOLVED';
        issue.resolved_at = new Date();
        issue.resolved_by = 'Automated ERPNext Sweep';
        await this.issueRepo.save(issue);
        autoResolved++;
      }
    }

    return { newIssues, autoResolved };
  }

  /**
   * Run manual or automated Catalog Sweep
   */
  async syncCatalogSweep() {
    this.logger.log('Starting on-demand catalog sweep...');
    const result = await this.syncErpCatalog();
    const dashboardData = await this.getDashboardData();
    return {
      ...result,
      dashboard: dashboardData,
    };
  }

  /**
   * Helper to seed initial Kanban tasks
   */
  async seedInitialTasks() {
    const taskCount = await this.taskRepo.count();
    if (taskCount > 0) return;

    const initialTasks: Partial<SeoTask>[] = [
      {
        title: 'Fix standard_rate for Floating Wooden Shelves (WW-SH-003)',
        description: 'Update ERPNext Item master rate from ₹0.00 to standard selling ₹2,499.00',
        assignee: 'ERP Admin',
        status: 'TODO',
        priority: 'CRITICAL',
        related_sku: 'WW-SH-003',
        monday_sign_off: true,
        order_index: 0,
      },
      {
        title: 'Replace dummy placeholder image on Teak Key Organizer (WW-ORG-004)',
        description: 'Upload high-resolution 1200x1200px studio product photo and set as ERP hero image',
        assignee: 'Content Writer',
        status: 'TODO',
        priority: 'CRITICAL',
        related_sku: 'WW-ORG-004',
        monday_sign_off: true,
        order_index: 1,
      },
      {
        title: 'Expand product copy for Hexagonal Wooden Wall Planters (WW-PL-007)',
        description: 'Write 250-word enriched description with wood specifications, dimensions, and botanical styling tips',
        assignee: 'Content Writer',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        related_sku: 'WW-PL-007',
        monday_sign_off: false,
        order_index: 0,
      },
      {
        title: 'Fix canonical URL redirect loop on discontinued Live Edge Table',
        description: 'Verify 301 redirect from /products/live-edge-walnut-table to category landing page',
        assignee: 'Developer',
        status: 'RESOLVED',
        priority: 'MEDIUM',
        related_sku: 'WW-TB-008',
        monday_sign_off: true,
        order_index: 0,
      },
    ];

    for (const t of initialTasks) {
      await this.taskRepo.save(this.taskRepo.create(t));
    }
  }

  /**
   * Helper to seed default Monday signoff checklist items
   */
  async seedInitialSignoffs() {
    const count = await this.signoffRepo.count();
    if (count > 0) return;

    const currentWeek = this.getCurrentWeekIdentifier();
    const defaultChecklist = [
      'Zero ₹0.00 Price defects & missing currency across all active ERP items',
      'All product hero images load without placeholder or broken 404 links',
      'No template placeholder demo text (Inkreatix/Lorem Ipsum) in catalog copy',
      'High-intent search queries ("wooden wall hooks", "wine rack") ranking in top 5',
      'Weekly GSC sitemap submitted & 100% indexed without crawl errors',
      'GA4 Organic E-commerce tracking & AOV funnel health check completed',
    ];

    for (const itemText of defaultChecklist) {
      await this.signoffRepo.save(
        this.signoffRepo.create({
          week_identifier: currentWeek,
          item_text: itemText,
          is_completed: false,
        }),
      );
    }
  }

  private getCurrentWeekIdentifier(): string {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const pastDaysOfYear = (now.getTime() - startOfYear.getTime()) / 86400000;
    const weekNum = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
    return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  }

  async getDashboardData(): Promise<SeoDashboardData> {
    const rawIssues = await this.issueRepo.find({
      order: {
        created_at: 'DESC',
      },
    });

    // Priority ordering: CRITICAL (1) -> HIGH (2) -> MEDIUM (3)
    const severityWeight: Record<string, number> = {
      CRITICAL: 1,
      HIGH: 2,
      MEDIUM: 3,
    };

    const issues = rawIssues.sort((a, b) => {
      const weightA = severityWeight[a.severity] || 99;
      const weightB = severityWeight[b.severity] || 99;
      if (weightA !== weightB) {
        return weightA - weightB;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const tasks = await this.taskRepo.find({
      order: {
        order_index: 'ASC',
        created_at: 'DESC',
      },
    });

    const currentWeek = this.getCurrentWeekIdentifier();
    let signoffs = await this.signoffRepo.find({
      where: { week_identifier: currentWeek },
    });

    if (signoffs.length === 0) {
      await this.seedInitialSignoffs();
      signoffs = await this.signoffRepo.find({
        where: { week_identifier: currentWeek },
      });
    }

    // Calculate Summary Metrics
    const activeIssues = issues.filter((i) => i.status === 'OPEN');
    const criticalIssues = activeIssues.filter((i) => i.severity === 'CRITICAL').length;
    const highIssues = activeIssues.filter((i) => i.severity === 'HIGH').length;
    const mediumIssues = activeIssues.filter((i) => i.severity === 'MEDIUM').length;

    const missingImages = activeIssues.filter((i) => i.defect_type === 'MISSING_IMAGE').length;
    const duplicateTitles = activeIssues.filter((i) => i.defect_type === 'DUPLICATE_TITLE').length;
    const invalidPrices = activeIssues.filter((i) => i.defect_type === 'INVALID_PRICE').length;
    const thinDescriptions = activeIssues.filter((i) => i.defect_type === 'THIN_DESCRIPTION').length;
    const missingDimensions = activeIssues.filter((i) => i.defect_type === 'MISSING_DIMENSIONS').length;

    const totalResolved = issues.filter((i) => i.status === 'RESOLVED').length;
    const totalSnoozed = issues.filter((i) => i.status === 'SNOOZED').length;

    // Distinct SKUs scanned
    const distinctSkus = new Set(issues.map((i) => i.sku)).size;
    const totalActiveSkus = Math.max(distinctSkus, 881);

    // Health Score calculation (100 - penalties)
    const penalty = criticalIssues * 2 + highIssues * 1 + mediumIssues * 0.5;
    const healthScore = Math.max(0, Math.min(100, Math.round(100 - (penalty / (totalActiveSkus || 1)) * 100)));

    const summary: SeoDashboardSummary = {
      totalActiveSkus,
      criticalIssues,
      highIssues,
      mediumIssues,
      missingImages,
      duplicateTitles,
      invalidPrices,
      thinDescriptions,
      missingDimensions,
      healthScore,
      totalResolved,
      totalSnoozed,
    };

    const gsc = await this.analyticsService.getGscPerformanceData();
    const ga4 = this.analyticsService.getGa4RevenueData();

    return {
      summary,
      issues: issues as SeoIssueDto[],
      gsc,
      ga4,
      tasks,
      signoffs,
    };
  }

  /**
   * Update issue status (Resolve or Snooze)
   */
  async updateIssueStatus(id: string, dto: UpdateIssueStatusDto): Promise<SeoIssue> {
    const issue = await this.issueRepo.findOne({ where: { id } });
    if (!issue) {
      throw new NotFoundException(`SEO Issue with ID ${id} not found`);
    }

    issue.status = dto.status;
    if (dto.status === 'RESOLVED') {
      issue.resolved_at = new Date();
      issue.resolved_by = dto.resolvedBy || 'SEO Admin';
      issue.snoozed_until = null;
      issue.snooze_reason = null;
    } else if (dto.status === 'SNOOZED') {
      const days = dto.snoozeDays || 7;
      const until = new Date();
      until.setDate(until.getDate() + days);
      issue.snoozed_until = until;
      issue.snooze_reason = dto.snoozeReason || `Snoozed for ${days} days`;
      issue.resolved_at = null;
      issue.resolved_by = null;
    } else if (dto.status === 'OPEN') {
      issue.snoozed_until = null;
      issue.snooze_reason = null;
      issue.resolved_at = null;
      issue.resolved_by = null;
    }

    return await this.issueRepo.save(issue);
  }

  /**
   * Kanban Tasks Operations
   */
  async createTask(dto: CreateSeoTaskDto): Promise<SeoTask> {
    const task = this.taskRepo.create({
      title: dto.title,
      description: dto.description || '',
      assignee: dto.assignee || 'ERP Admin',
      status: dto.status || 'TODO',
      priority: dto.priority || 'MEDIUM',
      related_sku: dto.related_sku || null,
      due_date: dto.due_date ? new Date(dto.due_date) : null,
      order_index: dto.order_index || 0,
      monday_sign_off: dto.monday_sign_off || false,
    });
    return await this.taskRepo.save(task);
  }

  async updateTask(id: string, dto: UpdateSeoTaskDto): Promise<SeoTask> {
    const task = await this.taskRepo.findOne({ where: { id } });
    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.assignee !== undefined) task.assignee = dto.assignee;
    if (dto.status !== undefined) task.status = dto.status;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.related_sku !== undefined) task.related_sku = dto.related_sku;
    if (dto.due_date !== undefined) task.due_date = dto.due_date ? new Date(dto.due_date) : null;
    if (dto.order_index !== undefined) task.order_index = dto.order_index;
    if (dto.monday_sign_off !== undefined) task.monday_sign_off = dto.monday_sign_off;

    return await this.taskRepo.save(task);
  }

  async deleteTask(id: string): Promise<boolean> {
    const res = await this.taskRepo.delete(id);
    return (res.affected || 0) > 0;
  }

  /**
   * Monday Checklist Toggle
   */
  async toggleSignoff(dto: ToggleSignoffDto): Promise<SeoSignoff> {
    let signoff = await this.signoffRepo.findOne({
      where: {
        week_identifier: dto.weekIdentifier,
        item_text: dto.itemText,
      },
    });

    if (!signoff) {
      signoff = this.signoffRepo.create({
        week_identifier: dto.weekIdentifier,
        item_text: dto.itemText,
      });
    }

    signoff.is_completed = dto.isCompleted;
    if (dto.isCompleted) {
      signoff.signed_off_at = new Date();
      signoff.signed_off_by = dto.signedOffBy || 'Operations Lead';
    } else {
      signoff.signed_off_at = null;
      signoff.signed_off_by = null;
    }

    return await this.signoffRepo.save(signoff);
  }

  /**
   * Generates RFC-4180 compliant CSV export for all catalog issues
   */
  async exportCsvReport(): Promise<string> {
    const issues = await this.issueRepo.find({
      order: {
        created_at: 'DESC',
      },
    });

    const escapeCsv = (str: any) => {
      if (str === null || str === undefined) return '""';
      const text = String(str).replace(/"/g, '""');
      return `"${text}"`;
    };

    const headers = [
      'SKU',
      'Product Name',
      'Category',
      'URL',
      'Issue Types',
      'Issue Details',
      'Severity',
      'Status',
      'First Seen',
      'Last Seen',
    ];

    const rows = issues.map((issue) => {
      const firstSeen = issue.created_at
        ? new Date(issue.created_at).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      const lastSeen = issue.updated_at
        ? new Date(issue.updated_at).toISOString().split('T')[0]
        : firstSeen;

      return [
        escapeCsv(issue.sku),
        escapeCsv(issue.product_name),
        escapeCsv(issue.category),
        escapeCsv(issue.live_url),
        escapeCsv(issue.defect_type),
        escapeCsv(issue.defect_details),
        escapeCsv(issue.severity),
        escapeCsv(issue.status),
        escapeCsv(firstSeen),
        escapeCsv(lastSeen),
      ].join(',');
    });

    return [headers.map((h) => `"${h}"`).join(','), ...rows].join('\r\n');
  }

  /**
   * Helper to snooze issue by days
   */
  async snoozeIssue(
    id: string,
    days: number = 7,
    reason: string = 'Pending content/ERP update',
  ): Promise<SeoIssue> {
    return this.updateIssueStatus(id, {
      status: 'SNOOZED',
      snoozeDays: days,
      snoozeReason: reason,
    });
  }

  /**
   * Helper to resolve issue
   */
  async resolveIssue(id: string, resolvedBy: string = 'SEO Auditor'): Promise<SeoIssue> {
    return this.updateIssueStatus(id, {
      status: 'RESOLVED',
      resolvedBy,
    });
  }

  /**
   * Record Monday Weekly Sign-Off
   */
  async recordSignoff(
    auditorName: string = 'Shubham',
    weekIdentifier?: string,
    notes?: string,
  ) {
    const week = weekIdentifier || this.getCurrentWeekIdentifier();
    const signoffs = await this.signoffRepo.find({
      where: { week_identifier: week },
    });

    for (const signoff of signoffs) {
      signoff.is_completed = true;
      signoff.signed_off_at = new Date();
      signoff.signed_off_by = auditorName;
      await this.signoffRepo.save(signoff);
    }

    return {
      success: true,
      weekIdentifier: week,
      auditor: auditorName,
      signedOffAt: new Date(),
      itemsSigned: signoffs.length,
      notes:
        notes ||
        'Weekly SEO & Catalog audit checklist verified and signed off.',
    };
  }
}
