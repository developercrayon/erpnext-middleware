import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('erp_suppliers')
export class ErpSupplier {
  @PrimaryColumn({ type: 'varchar', length: 500 })
  name: string; // ERPNext supplier name/ID

  @Index()
  @Column({ type: 'varchar', length: 500 })
  supplier_name: string;

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  gstin: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  tax_id: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone: string;

  @Column({ type: 'text', nullable: true })
  address: string;

  @Column({ type: 'varchar', length: 50, default: 'India' })
  country: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string;

  @Column({ type: 'varchar', length: 100, default: 'Net 30' })
  payment_terms: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
