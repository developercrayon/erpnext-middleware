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
import { Order } from './order.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'marketplace_item_id', type: 'varchar', nullable: true })
  marketplaceItemId: string;

  @Column({ name: 'sku', type: 'varchar' })
  sku: string;

  @Column({ name: 'marketplace_sku', type: 'varchar', nullable: true })
  marketplaceSku: string;

  @Column({ name: 'product_name', type: 'varchar' })
  productName: string;

  @Column({ name: 'quantity', type: 'int', default: 1 })
  quantity: number;

  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2 })
  unitPrice: number;

  @Column({ name: 'discount', type: 'decimal', precision: 12, scale: 2, default: 0 })
  discount: number;

  @Column({ name: 'tax', type: 'decimal', precision: 12, scale: 2, default: 0 })
  tax: number;

  @Column({ name: 'total', type: 'decimal', precision: 12, scale: 2 })
  total: number;

  @Column({ name: 'tax_rate', type: 'decimal', precision: 5, scale: 2, default: 0 })
  taxRate: number;

  @Column({ name: 'hsn_code', type: 'varchar', nullable: true })
  hsnCode: string;

  @Column({ name: 'item_status', type: 'varchar', nullable: true })
  itemStatus: string;

  @Column({ name: 'fulfillment_center', type: 'varchar', nullable: true })
  fulfillmentCenter: string;

  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
