import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ProcessingStatus } from '../../common/enums/processing-status.enum';
import { InvoiceExtractedData, ValidationResult, SupplierMatchResult } from '../../common/interfaces/invoice-schema.interface';
import { PurchaseInvoiceDocumentItem } from './purchase-invoice-document-item.entity';

@Entity('purchase_invoice_documents')
export class PurchaseInvoiceDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @Column({ type: 'varchar', length: 100 })
  file_type: string;

  @Column({ type: 'integer' })
  file_size: number;

  @Column({ type: 'varchar', length: 500 })
  file_path: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  file_url: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 50,
    default: ProcessingStatus.UPLOADED,
  })
  status: ProcessingStatus;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  supplier_name_extracted: string;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  invoice_number_extracted: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoice_date_extracted: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  due_date_extracted: string;

  @Column({ type: 'varchar', length: 10, default: 'INR' })
  currency: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  po_number: string;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  grand_total: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  tax_amount: number;

  @Column({ type: 'json', nullable: true })
  extracted_data: InvoiceExtractedData;

  @Column({ type: 'json', nullable: true })
  normalized_data: InvoiceExtractedData;

  @Column({ type: 'json', nullable: true })
  validation_result: ValidationResult;

  @Column({ type: 'json', nullable: true })
  supplier_matching_result: SupplierMatchResult;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  confidence_score: number;

  @Index()
  @Column({ type: 'varchar', length: 500, nullable: true })
  erpnext_supplier_id: string;

  @Index()
  @Column({ type: 'varchar', length: 200, nullable: true })
  erpnext_invoice_id: string;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @Column({ type: 'json', nullable: true })
  erpnext_response: any;

  @Column({ type: 'varchar', length: 100, default: 'system' })
  created_by: string;

  @OneToMany(
    () => PurchaseInvoiceDocumentItem,
    (item) => item.document,
    { cascade: true, eager: true }
  )
  items: PurchaseInvoiceDocumentItem[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
