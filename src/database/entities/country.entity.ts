import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('countries')
export class Country {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'erpnext', type: 'varchar', nullable: true })
  erpnext: string;

  @Column({ name: 'code', type: 'varchar', nullable: true })
  code: string;

  @Column({ name: 'amazon', type: 'varchar', nullable: true })
  amazon: string;

  @Column({ name: 'flipkart', type: 'varchar', nullable: true })
  flipkart: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
