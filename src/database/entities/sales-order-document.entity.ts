import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { SalesOrderItem } from './sales-order-item.entity';

export enum SalesOrderStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  SYNCED_ERP = 'SYNCED_ERP',
  CANCELLED = 'CANCELLED',
}

export enum SalesOrderSource {
  MANUAL = 'MANUAL',
  AI_OCR = 'AI_OCR',
  AI_CHAT = 'AI_CHAT',
  AI_VOICE = 'AI_VOICE',
}

@Entity('sales_order_documents')
export class SalesOrderDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  order_id: string; // e.g. 'WW-SO-10293' or 'SO-2026-001'

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
  order_date: string; // YYYY-MM-DD

  @Column({ type: 'varchar', length: 50 })
  delivery_date: string; // YYYY-MM-DD

  @Column({ type: 'varchar', length: 100, nullable: true })
  po_no: string;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 50,
    default: SalesOrderSource.MANUAL,
  })
  source: SalesOrderSource;

  @Index()
  @Column({
    type: 'varchar',
    length: 50,
    default: SalesOrderStatus.DRAFT,
  })
  status: SalesOrderStatus;

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
  erpnext_so_id: string; // Linked name in ERPNext (e.g. 'SAL-ORD-2026-00001')

  @Column({ type: 'varchar', length: 50, default: 'NOT_SYNCED' })
  erpnext_sync_status: string;

  @Column({ type: 'text', nullable: true })
  erpnext_error: string;

  @Column({ type: 'json', nullable: true })
  erpnext_response: any;

  @Column({ type: 'text', nullable: true })
  raw_ai_input: string; // Transcribed voice / Chatboard prompt / OCR details

  @Column({ type: 'varchar', length: 100, default: 'User' })
  created_by: string;

  @OneToMany(() => SalesOrderItem, (item) => item.sales_order, {
    cascade: true,
    eager: true,
  })
  items: SalesOrderItem[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
