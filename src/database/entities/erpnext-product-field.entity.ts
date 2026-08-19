import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('erpnext_product_field')
export class ErpnextProductField {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  name: string;

  @Column({ type: 'int', default: 0 })
  idx: number;

  @Column({ type: 'varchar', nullable: true })
  label: string;

  @Column({ type: 'varchar', nullable: true })
  fieldtype: string;

  @Column({ type: 'text', nullable: true })
  options: string;

  @Column({ name: 'fetch_from', type: 'text', nullable: true })
  fetchFrom: string;

  @Column({ name: 'default_value', type: 'text', nullable: true })
  defaultValue: string;

  @Column({ name: 'is_custom', type: 'boolean', default: false })
  isCustom: boolean;

  @Column({ name: 'amazon_template', type: 'text', nullable: true })
  amazonTemplate: string;

  @Column({ name: 'flipkart_template', type: 'text', nullable: true })
  flipkartTemplate: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
