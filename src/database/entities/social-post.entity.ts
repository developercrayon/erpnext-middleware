import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum SocialPostStatus {
  DRAFT = 'DRAFT', // initial creation
  GENERATING = 'GENERATING', // processing in BullMQ
  GENERATED_READY_FOR_REVIEW = 'GENERATED_READY_FOR_REVIEW',
  APPROVED = 'APPROVED',
  SCHEDULED = 'SCHEDULED',
  PUBLISHING = 'PUBLISHING',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
}

export enum PostType {
  STATIC = 'Static',
  CAROUSEL = 'Carousel',
  REEL = 'Reel',
}

@Entity('social_posts')
export class SocialPost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'product_item_code', nullable: true })
  productItemCode: string;

  @Column({ name: 'campaign_id', nullable: true })
  campaignId: string;

  @Column({ nullable: true })
  platform: string;

  @Column({ type: 'enum', enum: PostType, default: PostType.STATIC })
  postType: PostType;

  @Column({ name: 'marketing_goal', type: 'text', nullable: true })
  marketingGoal: string;

  @Column({ name: 'aspect_ratio', nullable: true })
  aspectRatio: string;

  // Generated Content Fields
  @Column({ name: 'generated_post', type: 'text', nullable: true })
  generatedPost: string;

  @Column({ type: 'text', nullable: true })
  caption: string;

  @Column({ type: 'text', nullable: true })
  hashtags: string;

  @Column({ type: 'text', nullable: true })
  hook: string;

  @Column({ type: 'text', nullable: true })
  cta: string;

  @Column({ name: 'video_reel_script', type: 'text', nullable: true })
  videoReelScript: string;

  // Custom Prompts Used (from UI)
  @Column({ name: 'custom_prompts', type: 'jsonb', nullable: true })
  customPrompts: Record<string, string>;

  // Images/Media
  @Column({ type: 'jsonb', nullable: true, default: [] })
  mediaUrls: string[];

  @Column({ type: 'enum', enum: SocialPostStatus, default: SocialPostStatus.DRAFT })
  status: SocialPostStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'scheduled_at', type: 'timestamp', nullable: true })
  scheduledAt: Date;

  @Column({ name: 'published_at', type: 'timestamp', nullable: true })
  publishedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
