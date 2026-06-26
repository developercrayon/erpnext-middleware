import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { MarketplaceSource } from './order.entity';

@Entity('inventory')
@Index(['sku', 'warehouse', 'source'], { unique: true })
export class Inventory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'sku', type: 'varchar' })
  sku: string;

  @Column({ name: 'erpnext_item_code', type: 'varchar', nullable: true })
  erpnextItemCode: string;

  @Column({ name: 'warehouse', type: 'varchar' })
  warehouse: string;

  @Column({ name: 'source', type: 'enum', enum: MarketplaceSource, nullable: true })
  source: MarketplaceSource;

  @Column({ name: 'actual_qty', type: 'decimal', precision: 12, scale: 3, default: 0 })
  actualQty: number;

  @Column({ name: 'reserved_qty', type: 'decimal', precision: 12, scale: 3, default: 0 })
  reservedQty: number;

  @Column({ name: 'available_qty', type: 'decimal', precision: 12, scale: 3, default: 0 })
  availableQty: number;

  @Column({ name: 'marketplace_qty', type: 'decimal', precision: 12, scale: 3, default: 0 })
  marketplaceQty: number;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('inventory_syncs')
export class InventorySync {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sku', type: 'varchar' })
  sku: string;

  @Column({ name: 'source', type: 'enum', enum: MarketplaceSource })
  source: MarketplaceSource;

  @Column({ name: 'warehouse', type: 'varchar', nullable: true })
  warehouse: string;

  @Column({ name: 'qty_before', type: 'decimal', precision: 12, scale: 3, nullable: true })
  qtyBefore: number;

  @Column({ name: 'qty_after', type: 'decimal', precision: 12, scale: 3, nullable: true })
  qtyAfter: number;

  @Column({ name: 'sync_status', type: 'varchar', default: 'PENDING' })
  syncStatus: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
