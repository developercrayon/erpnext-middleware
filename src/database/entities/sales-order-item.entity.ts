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
import { SalesOrderDocument } from './sales-order-document.entity';

@Entity('sales_order_items')
export class SalesOrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ nullable: true })
  sales_order_id: string;

  @ManyToOne(() => SalesOrderDocument, (doc) => doc.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sales_order_id' })
  sales_order: SalesOrderDocument;

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

  @Column({ type: 'varchar', length: 50, nullable: true })
  delivery_date: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
