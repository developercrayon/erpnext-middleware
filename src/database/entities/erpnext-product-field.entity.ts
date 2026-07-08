import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('erpnext_product_field')
export class ErpnextProductField {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  name: string;

  @Column({ type: 'varchar', nullable: true })
  label: string;

  @Column({ type: 'varchar', nullable: true })
  fieldtype: string;

  @Column({ name: 'is_custom', type: 'boolean', default: false })
  isCustom: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
