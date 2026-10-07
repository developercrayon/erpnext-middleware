import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

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

@Entity('seo_issues')
export class SeoIssue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  sku: string;

  @Column({ type: 'varchar', length: 500 })
  product_name: string;

  @Column({ type: 'varchar', length: 255, default: 'Uncategorized' })
  category: string;

  @Column({ type: 'text', nullable: true })
  live_url: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  defect_type: SeoDefectType;

  @Column({ type: 'varchar', length: 20 })
  severity: SeoSeverity;

  @Index()
  @Column({ type: 'varchar', length: 20, default: 'OPEN' })
  status: SeoStatus;

  @Column({ type: 'text', nullable: true })
  defect_details: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  owner: string | null;

  @Column({ type: 'timestamp', nullable: true })
  snoozed_until: Date | null;

  @Column({ type: 'text', nullable: true })
  snooze_reason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  resolved_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolved_by: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
