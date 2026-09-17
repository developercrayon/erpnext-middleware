import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('erp_items')
export class ErpItem {
  @PrimaryColumn({ type: 'varchar', length: 500 })
  item_code: string;

  @Index()
  @Column({ type: 'varchar', length: 500 })
  item_name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Index()
  @Column({ type: 'varchar', length: 50, nullable: true })
  gst_hsn_code: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  item_group: string;

  @Column({ type: 'varchar', length: 50, default: 'Nos' })
  stock_uom: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  supplier_part_no: string;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  barcode: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  standard_rate: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 18 })
  default_tax_rate: number;

  @Column({ type: 'varchar', length: 100, default: 'Stores - AC' })
  default_warehouse: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
