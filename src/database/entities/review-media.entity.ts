import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ReviewMediaType } from '../../common/enums/review.enums';
import { Review } from './review.entity';

@Entity('review_media')
export class ReviewMedia {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  review_id: string;

  @ManyToOne(() => Review, (review) => review.media, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'review_id' })
  review: Review;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  review_session_id: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 50,
    default: ReviewMediaType.IMAGE,
  })
  type: ReviewMediaType;

  @Column({ type: 'varchar', length: 500 })
  url: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  thumbnail_url: string;

  @Column({ type: 'varchar', length: 100 })
  mime_type: string;

  @Column({ type: 'integer', default: 0 })
  file_size: number;

  @Column({ type: 'integer', nullable: true })
  duration: number;

  @Column({ type: 'text', nullable: true })
  transcript: string;

  @CreateDateColumn()
  created_at: Date;
}
