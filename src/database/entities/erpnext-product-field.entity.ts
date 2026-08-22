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

  @Column({ name: 'reqd', type: 'boolean', default: false })
  reqd: boolean;

  @Column({ name: 'collapsible', type: 'boolean', default: false })
  collapsible: boolean;

  @Column({ name: 'insert_after', type: 'varchar', nullable: true })
  insertAfter: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
