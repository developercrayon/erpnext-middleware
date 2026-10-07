import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type SeoTaskStatus = 'TODO' | 'IN_PROGRESS' | 'RESOLVED';
export type SeoTaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

@Entity('seo_tasks')
export class SeoTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 255, default: 'ERP Admin' })
  assignee: string; // e.g. 'Content Writer', 'ERP Admin', 'Developer'

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'TODO' })
  status: SeoTaskStatus;

  @Column({ type: 'varchar', length: 50, default: 'MEDIUM' })
  priority: SeoTaskPriority;

  @Column({ type: 'varchar', length: 255, nullable: true })
  related_sku: string | null;

  @Column({ type: 'timestamp', nullable: true })
  due_date: Date | null;

  @Column({ type: 'int', default: 0 })
  order_index: number;

  @Column({ type: 'boolean', default: false })
  monday_sign_off: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
