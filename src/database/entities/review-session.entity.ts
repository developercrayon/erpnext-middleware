import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ReviewSessionStatus } from '../../common/enums/review.enums';
import { Review } from './review.entity';
import { ReviewEvent } from './review-event.entity';

@Entity('review_sessions')
export class ReviewSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  token: string;

  @Index()
  @Column({ type: 'varchar', length: 100, default: 'woodwolff' })
  store_id: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  order_id: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  customer_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_email: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  customer_phone: string;

  @Index()
  @Column({
    type: 'varchar',
    length: 50,
    default: ReviewSessionStatus.PENDING,
  })
  status: ReviewSessionStatus;

  @Column({ nullable: true })
  expires_at: Date;

  @Column({ nullable: true })
  first_opened_at: Date;

  @Column({ nullable: true })
  last_opened_at: Date;

  @Column({ nullable: true })
  completed_at: Date;

  @Column({ type: 'json', nullable: true })
  order_metadata: any;

  @OneToMany(() => Review, (review) => review.session, { cascade: true })
  reviews: Review[];

  @OneToMany(() => ReviewEvent, (event) => event.session, { cascade: true })
  events: ReviewEvent[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
