export type SeoDefectType =
  | 'INVALID_PRICE'
  | 'MISSING_IMAGE'
  | 'THIN_DESCRIPTION'
  | 'MISSING_DIMENSIONS'
  | 'DUPLICATE_TITLE'
  | 'OVER_BUDGET_TITLE'
  | 'BLOCKLIST_CONTENT'
  | 'CANONICAL_MISMATCH'
  | 'SITEMAP_MISMATCH';

export type SeoSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM';
export type SeoStatus = 'OPEN' | 'RESOLVED' | 'SNOOZED';

export interface SeoIssueDto {
  id: string;
  sku: string;
  product_name: string;
  category: string;
  live_url: string;
  defect_type: SeoDefectType;
  severity: SeoSeverity;
  status: SeoStatus;
  defect_details: string;
  owner?: string | null;
  snoozed_until?: Date | null;
  snooze_reason?: string | null;
  resolved_at?: Date | null;
  resolved_by?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface GscDailyMetric {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscKeywordMetric {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  trend: number[]; // mini series for sparkline
  change: number; // % change vs previous period
}

export interface Ga4CategoryMetric {
  category: string;
  revenue: number;
  transactions: number;
  aov: number;
  conversion_rate: number;
  items_affected: number;
  health_status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
}

export interface Ga4Summary {
  organic_revenue: number;
  revenue_growth_pct: number;
  transactions: number;
  aov: number;
  aov_growth_pct: number;
  conversion_rate: number;
  conversion_rate_growth_pct: number;
  categories: Ga4CategoryMetric[];
}

export interface SeoDashboardSummary {
  totalActiveSkus: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  missingImages: number;
  duplicateTitles: number;
  invalidPrices: number;
  thinDescriptions: number;
  missingDimensions: number;
  healthScore: number; // 0 - 100
  totalResolved: number;
  totalSnoozed: number;
}

export interface SeoDashboardData {
  summary: SeoDashboardSummary;
  issues: SeoIssueDto[];
  gsc: {
    totals: {
      clicks: number;
      impressions: number;
      avg_ctr: number;
      avg_position: number;
    };
    time_series: GscDailyMetric[];
    keywords: GscKeywordMetric[];
  };
  ga4: Ga4Summary;
  tasks: any[];
  signoffs: any[];
}
