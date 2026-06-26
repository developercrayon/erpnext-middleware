import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { MarketplaceSource } from './order.entity';

@Entity('price_syncs')
export class PriceSync {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sku', type: 'varchar' })
  sku: string;

  @Column({ name: 'source', type: 'enum', enum: MarketplaceSource })
  source: MarketplaceSource;

  @Column({ name: 'price_before', type: 'decimal', precision: 12, scale: 2, nullable: true })
  priceBefore: number;

  @Column({ name: 'price_after', type: 'decimal', precision: 12, scale: 2, nullable: true })
  priceAfter: number;

  @Column({ name: 'mrp', type: 'decimal', precision: 12, scale: 2, nullable: true })
  mrp: number;

  @Column({ name: 'price_list', type: 'varchar', nullable: true })
  priceList: string;

  @Column({ name: 'sync_status', type: 'varchar', default: 'PENDING' })
  syncStatus: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('shipment_syncs')
export class ShipmentSync {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string;

  @Column({ name: 'marketplace_order_id', type: 'varchar' })
  marketplaceOrderId: string;

  @Column({ name: 'source', type: 'enum', enum: MarketplaceSource })
  source: MarketplaceSource;

  @Column({ name: 'tracking_number', type: 'varchar', nullable: true })
  trackingNumber: string;

  @Column({ name: 'carrier', type: 'varchar', nullable: true })
  carrier: string;

  @Column({ name: 'carrier_service', type: 'varchar', nullable: true })
  carrierService: string;

  @Column({ name: 'erpnext_delivery_note_id', type: 'varchar', nullable: true })
  erpnextDeliveryNoteId: string;

  @Column({ name: 'shipped_at', type: 'timestamptz', nullable: true })
  shippedAt: Date;

  @Column({ name: 'estimated_delivery', type: 'timestamptz', nullable: true })
  estimatedDelivery: Date;

  @Column({ name: 'sync_status', type: 'varchar', default: 'PENDING' })
  syncStatus: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
