import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { AmazonProductField } from './amazon-product-field.entity';

@Entity('amazon_product_type')
export class AmazonProductType {
  @PrimaryColumn({ type: 'varchar' })
  name: string;

  @Column({ name: 'display_name', type: 'varchar', nullable: true })
  displayName: string;

  @Column({ type: 'jsonb', nullable: true })
  marketplaces: string[];

  @OneToMany(() => AmazonProductField, (field) => field.productType)
  fields: AmazonProductField[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
