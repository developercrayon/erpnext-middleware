import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { SalesInvoiceDocument } from './sales-invoice-document.entity';

@Entity('sales_invoice_items')
export class SalesInvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ nullable: true })
  sales_invoice_id: string;

  @ManyToOne(() => SalesInvoiceDocument, (doc) => doc.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sales_invoice_id' })
  sales_invoice: SalesInvoiceDocument;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  item_code: string;

  @Column({ type: 'varchar', length: 500 })
  item_name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  hsn_code: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 1 })
  qty: number;

  @Column({ type: 'varchar', length: 50, default: 'Nos' })
  uom: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  rate: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  discount_percentage: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  discount_amount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 18 })
  tax_percentage: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  tax_amount: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'varchar', length: 255, default: 'Stores - woodwolf' })
  warehouse: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  cost_center: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
