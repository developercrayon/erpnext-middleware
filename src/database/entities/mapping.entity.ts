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

  @Column({ name: 'default_value', type: 'varchar', nullable: true })
  defaultValue: string;

  @Column({ name: 'erpnext_template', type: 'text', nullable: true })
  erpnextTemplate: string;

  @Column({ name: 'amazon_template', type: 'text', nullable: true })
  amazonTemplate: string;

  @Column({ name: 'flipkart_template', type: 'text', nullable: true })
  flipkartTemplate: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
