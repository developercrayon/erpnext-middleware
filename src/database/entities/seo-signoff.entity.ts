import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('seo_signoffs')
export class SeoSignoff {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  week_identifier: string; // e.g. '2026-W14'

  @Column({ type: 'varchar', length: 500 })
  item_text: string;

  @Column({ type: 'boolean', default: false })
  is_completed: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  signed_off_by: string | null;

  @Column({ type: 'timestamp', nullable: true })
  signed_off_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
