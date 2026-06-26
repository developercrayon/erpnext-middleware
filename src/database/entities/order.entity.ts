import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  RETURNED = 'RETURNED',
  REFUNDED = 'REFUNDED',
}

export enum MarketplaceSource {
  AMAZON = 'AMAZON',
  FLIPKART = 'FLIPKART',
}

export enum SyncStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  SYNCED = 'SYNCED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

@Entity('orders')
@Index(['marketplaceOrderId', 'source'], { unique: true })
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'marketplace_order_id', type: 'varchar' })
  marketplaceOrderId: string;

  @Column({ name: 'source', type: 'enum', enum: MarketplaceSource })
  source: MarketplaceSource;

  @Column({ name: 'status', type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Column({ name: 'sync_status', type: 'enum', enum: SyncStatus, default: SyncStatus.PENDING })
  syncStatus: SyncStatus;

  @Column({ name: 'erpnext_sales_order_id', type: 'varchar', nullable: true })
  erpnextSalesOrderId: string;

  @Column({ name: 'erpnext_invoice_id', type: 'varchar', nullable: true })
  erpnextInvoiceId: string;

  @Column({ name: 'customer_name', type: 'varchar' })
  customerName: string;

  @Column({ name: 'customer_email', type: 'varchar', nullable: true })
  customerEmail: string;

  @Column({ name: 'customer_phone', type: 'varchar', nullable: true })
  customerPhone: string;

  @Column({ name: 'shipping_address', type: 'jsonb', nullable: true })
  shippingAddress: Record<string, any>;

  @Column({ name: 'billing_address', type: 'jsonb', nullable: true })
  billingAddress: Record<string, any>;

  @Column({ name: 'subtotal', type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @Column({ name: 'discount', type: 'decimal', precision: 12, scale: 2, default: 0 })
  discount: number;

  @Column({ name: 'tax', type: 'decimal', precision: 12, scale: 2, default: 0 })
  tax: number;

  @Column({ name: 'shipping_charge', type: 'decimal', precision: 12, scale: 2, default: 0 })
  shippingCharge: number;

  @Column({ name: 'total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: number;

  @Column({ name: 'currency', type: 'varchar', length: 3, default: 'INR' })
  currency: string;

  @Column({ name: 'payment_method', type: 'varchar', nullable: true })
  paymentMethod: string;

  @Column({ name: 'payment_status', type: 'varchar', nullable: true })
  paymentStatus: string;

  @Column({ name: 'marketplace_order_date', type: 'timestamptz', nullable: true })
  marketplaceOrderDate: Date;

  @Column({ name: 'promised_delivery_date', type: 'timestamptz', nullable: true })
  promisedDeliveryDate: Date;

  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, any>;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
