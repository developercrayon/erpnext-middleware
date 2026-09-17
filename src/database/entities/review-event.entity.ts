import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ReviewSession } from './review-session.entity';

@Entity('review_events')
export class ReviewEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  review_session_id: string;

  @ManyToOne(() => ReviewSession, (session) => session.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'review_session_id' })
  session: ReviewSession;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  event: string;

  @Index()
  @Column({ type: 'varchar', length: 50, default: 'DIRECT' })
  source: string;

  @Column({ type: 'json', nullable: true })
  metadata: any;

  @CreateDateColumn()
  created_at: Date;
}
