import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { SalesInvoiceItem } from './sales-invoice-item.entity';

export enum SalesInvoiceStatus {
  DRAFT = 'DRAFT',
  PAID = 'PAID',
  UNPAID = 'UNPAID',
  SYNCED_ERP = 'SYNCED_ERP',
  CANCELLED = 'CANCELLED',
}

@Entity('sales_invoice_documents')
export class SalesInvoiceDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  invoice_number: string; // e.g. 'SINV-2026-0001'

  @Index()
  @Column({ nullable: true })
  sales_order_id: string; // Linked local sales_order_documents.id if converted

  @Index()
  @Column({ type: 'varchar', length: 200, nullable: true })
  erpnext_so_id: string; // Linked ERPNext Sales Order ID

  @Index()
  @Column({ type: 'varchar', length: 500 })
  customer_name: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  customer_email: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  customer_phone: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  customer_gstin: string;

  @Column({ type: 'text', nullable: true })
  billing_address: string;

  @Column({ type: 'text', nullable: true })
  shipping_address: string;

  @Column({ type: 'varchar', length: 50 })
  posting_date: string; // YYYY-MM-DD

  @Column({ type: 'varchar', length: 50, nullable: true })
  due_date: string; // YYYY-MM-DD

  @Column({ type: 'varchar', length: 100, default: 'Net 30' })
  payment_terms: string;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency: string;

  @Column({ type: 'boolean', default: true })
  update_stock: boolean;

  @Index()
  @Column({
    type: 'varchar',
    length: 50,
    default: SalesInvoiceStatus.DRAFT,
  })
  status: SalesInvoiceStatus;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  total_discount: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  taxable_amount: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  cgst: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  sgst: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  igst: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  total_tax: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  grand_total: number;

  @Index()
  @Column({ type: 'varchar', length: 200, nullable: true })
  erpnext_invoice_id: string; // Linked name in ERPNext (e.g. 'ACC-SINV-2026-00001')

  @Column({ type: 'varchar', length: 50, default: 'NOT_SYNCED' })
  erpnext_sync_status: string;

  @Column({ type: 'text', nullable: true })
  erpnext_error: string;

  @Column({ type: 'json', nullable: true })
  erpnext_response: any;

  @Column({ type: 'varchar', length: 100, default: 'User' })
  created_by: string;

  @OneToMany(() => SalesInvoiceItem, (item) => item.sales_invoice, {
    cascade: true,
    eager: true,
  })
  items: SalesInvoiceItem[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
