import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { AmazonProductType } from './amazon-product-type.entity';

@Entity('amazon_product_field')
export class AmazonProductField {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  label: string;

  @Column({ name: 'is_required', type: 'boolean', default: false })
  isRequired: boolean;

  @Column({ type: 'jsonb', nullable: true })
  schema: any;

  @ManyToOne(() => AmazonProductType, (productType) => productType.fields, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_type_name' })
  productType: AmazonProductType;

  @Column({ name: 'product_type_name', type: 'varchar' })
  productTypeName: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
