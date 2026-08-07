import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('amazon_variant_mapping')
export class AmazonVariantMapping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'marketplace', type: 'varchar' })
  marketplace: string;

  @Column({ name: 'product_type', type: 'varchar' })
  productType: string;

  @Column({ name: 'amazon_variation_theme', type: 'varchar' })
  amazonVariationTheme: string;

  @Column({ name: 'erpnext_attribute', type: 'varchar' })
  erpnextAttribute: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
