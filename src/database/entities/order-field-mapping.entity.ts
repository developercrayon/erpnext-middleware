import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { MarketplaceSource } from './order.entity';

export enum FieldGroup {
  ORDER = 'Order',
  CUSTOMER = 'Customer',
  PRODUCT = 'Product',
}

@Entity('order_field_mapping')
export class OrderFieldMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: MarketplaceSource,
    default: MarketplaceSource.AMAZON,
  })
  marketplace: MarketplaceSource;

  @Column({
    name: 'field_group',
    type: 'enum',
    enum: FieldGroup,
    default: FieldGroup.ORDER,
  })
  fieldGroup: FieldGroup;

  @Column({ name: 'erpnext_field', type: 'varchar' })
  erpnextField: string;

  @Column({ name: 'amazon_field', type: 'varchar', nullable: true })
  amazonField: string;

  @Column({ name: 'flipkart_field', type: 'varchar', nullable: true })
  flipkartField: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
