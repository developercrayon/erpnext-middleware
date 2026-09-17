import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { ReviewStatus } from '../../common/enums/review.enums';
import { ReviewSession } from './review-session.entity';
import { ReviewMedia } from './review-media.entity';
import { ReviewAiAnalysis } from './review-ai-analysis.entity';

@Entity('reviews')
@Unique(['customer_id', 'order_item_id'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 100, default: 'woodwolff' })
  store_id: string;

  @Index()
  @Column({ type: 'uuid' })
  review_session_id: string;

  @ManyToOne(() => ReviewSession, (session) => session.reviews, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'review_session_id' })
  session: ReviewSession;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  order_id: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  order_item_id: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  customer_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_name: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  product_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  product_name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  product_image_url: string;

  @Column({ type: 'float', default: 5 })
  rating: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ type: 'text', nullable: true })
  original_content: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 50,
    default: ReviewStatus.PENDING_MODERATION,
  })
  status: ReviewStatus;

  @Column({ type: 'boolean', default: true })
  verified_purchase: boolean;

  @Column({ type: 'boolean', default: false })
  ai_generated: boolean;

  @Column({ type: 'boolean', default: false })
  ai_edited_by_customer: boolean;

  @Column({ nullable: true })
  submitted_at: Date;

  @Column({ nullable: true })
  approved_at: Date;

  @Column({ nullable: true })
  published_at: Date;

  @Column({ type: 'varchar', length: 50, default: 'DIRECT' })
  source: string;

  @OneToMany(() => ReviewMedia, (media) => media.review, { cascade: true, eager: true })
  media: ReviewMedia[];

  @OneToOne(() => ReviewAiAnalysis, (analysis) => analysis.review, { cascade: true, eager: true })
  ai_analysis: ReviewAiAnalysis;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
