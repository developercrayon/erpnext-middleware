import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  entity_type: string; // e.g. 'PURCHASE_INVOICE_DOCUMENT'

  @Index()
  @Column({ type: 'varchar', length: 100 })
  entity_id: string;

  @Column({ type: 'varchar', length: 100, default: 'System' })
  user: string;

  @Column({ type: 'varchar', length: 100 })
  action: string; // e.g. 'INVOICE_UPLOADED', 'AI_EXTRACTION_COMPLETED', 'ERP_CREATED'

  @Column({ type: 'text', nullable: true })
  details: string;

  @Column({ type: 'json', nullable: true })
  metadata: any;

  @CreateDateColumn()
  timestamp: Date;
}
