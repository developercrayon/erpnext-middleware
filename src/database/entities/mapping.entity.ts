import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { MarketplaceSource } from './order.entity';

@Entity('field_mappings')
export class FieldMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: MarketplaceSource,
    default: MarketplaceSource.AMAZON,
  })
  marketplace: MarketplaceSource;

  @Column({ name: 'product_type', type: 'varchar', nullable: true })
  productType: string;

  @Column({ name: 'erpnext_field', type: 'varchar' })
  erpnextField: string;

  @Column({ name: 'marketplace_field', type: 'varchar' })
  marketplaceField: string;

  @Column({ name: 'data_type', type: 'varchar', default: 'STRING' })
  dataType: string;

  @Column({ name: 'use_default', type: 'boolean', default: false })
  useDefault: boolean;

  @Column({ name: 'default_value', type: 'varchar', nullable: true })
  defaultValue: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
