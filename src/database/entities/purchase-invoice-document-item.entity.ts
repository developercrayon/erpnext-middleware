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
import { PurchaseInvoiceDocument } from './purchase-invoice-document.entity';

@Entity('purchase_invoice_document_items')
export class PurchaseInvoiceDocumentItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ nullable: true })
  document_id: string;

  @ManyToOne(() => PurchaseInvoiceDocument, (doc) => doc.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'document_id' })
  document: PurchaseInvoiceDocument;

  @Column({ type: 'text' })
  description_extracted: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  item_code_extracted: string;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  erpnext_item_code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  erpnext_item_name: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 1 })
  quantity: number;

  @Column({ type: 'varchar', length: 20, default: 'Nos' })
  uom: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  rate: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  discount_percentage: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  discount_amount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  tax_percentage: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  tax_amount: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  amount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  confidence_score: number;

  @Column({ type: 'varchar', length: 50, default: 'PENDING' })
  match_status: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  match_reason: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
