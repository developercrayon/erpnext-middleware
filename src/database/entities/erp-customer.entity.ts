import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('erp_customers')
export class ErpCustomer {
  @PrimaryColumn({ type: 'varchar', length: 500 })
  name: string; // ERPNext Customer ID / Name (e.g. 'Priya Sharma' or 'CUST-0001')

  @Index()
  @Column({ type: 'varchar', length: 500 })
  customer_name: string;

  @Column({ type: 'varchar', length: 150, default: 'All Customer Groups' })
  customer_group: string;

  @Column({ type: 'varchar', length: 50, default: 'Company' })
  customer_type: string;

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

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string;

  @Column({ type: 'varchar', length: 50, default: 'India' })
  country: string;

  @Column({ type: 'varchar', length: 100, default: 'Standard Selling' })
  default_price_list: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
