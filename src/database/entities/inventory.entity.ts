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
