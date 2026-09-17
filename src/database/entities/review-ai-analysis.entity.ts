import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Review } from './review.entity';

@Entity('review_ai_analyses')
export class ReviewAiAnalysis {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  review_id: string;

  @OneToOne(() => Review, (review) => review.ai_analysis, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'review_id' })
  review: Review;

  @Column({ type: 'varchar', length: 50, default: 'neutral' })
  sentiment: string;

  @Column({ type: 'json', nullable: true })
  topics: string[];

  @Column({ type: 'json', nullable: true })
  keywords: string[];

  @Column({ type: 'text', nullable: true })
  summary: string;

  @Column({ type: 'json', nullable: true })
  aspect_ratings: {
    product_quality?: number;
    design?: number;
    durability?: number;
    packaging?: number;
    delivery?: number;
    value_for_money?: number;
    ease_of_use?: number;
  };

  @CreateDateColumn()
  created_at: Date;
}
