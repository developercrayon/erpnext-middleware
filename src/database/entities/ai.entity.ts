import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum AiConfigType {
  CONTENT = 'content',
  IMAGE = 'image',
}

export enum AiGenerationJobStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum AiProductDataStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  GENERATED = 'generated',
  CONVERTED = 'converted',
}

// ─── AiConfig ─────────────────────────────────────────────────────────────────

/**
 * Stores AI provider configuration for content generation or image generation.
 * One row per type (content | image). Credentials encrypted at rest.
 */
@Entity('ai_config')
export class AiConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'config_type',
    type: 'enum',
    enum: AiConfigType,
    unique: true,
  })
  configType: AiConfigType;

  @Column({ name: 'provider', type: 'varchar', length: 50 })
  provider: string;

  @Column({ name: 'model', type: 'varchar', length: 100 })
  model: string;

  /** AES-256-GCM encrypted API key — NEVER returned to frontend */
  @Column({ name: 'api_key_encrypted', type: 'text', nullable: true })
  apiKeyEncrypted: string | null;

  /** AES-256-GCM encrypted API secret — NEVER returned to frontend */
  @Column({ name: 'api_secret_encrypted', type: 'text', nullable: true })
  apiSecretEncrypted: string | null;

  /** System prompt for content AI (not applicable for image AI) */
  @Column({ name: 'content_prompt', type: 'text', nullable: true })
  contentPrompt: string | null;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean;

  @OneToMany(() => AiImagePrompt, (p) => p.aiConfig, { cascade: true })
  imagePrompts: AiImagePrompt[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// ─── AiImagePrompt ────────────────────────────────────────────────────────────

/**
 * Dynamic image generation prompts linked to an Image AiConfig.
 * Each enabled prompt = one generated image.
 */
@Entity('ai_image_prompts')
export class AiImagePrompt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AiConfig, (c) => c.imagePrompts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ai_config_id' })
  aiConfig: AiConfig;

  @Column({ name: 'ai_config_id' })
  aiConfigId: string;

  @Column({ name: 'prompt_text', type: 'text' })
  promptText: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// ─── AiProductData ────────────────────────────────────────────────────────────

/**
 * Stores the user's AI creation session: input, generated content, generated
 * images, and status. One row per AI creation attempt.
 * Images are stored on disk; this table holds their paths and metadata.
 */
@Entity('ai_product_data')
export class AiProductData {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * User input collected before generation.
   * { item_name, description, reference_image_url?, reference_image_base64?, original_image_url? }
   */
  @Column({ name: 'user_input', type: 'jsonb' })
  userInput: {
    item_name: string;
    description: string;
    reference_image_url?: string;
    reference_image_base64?: string;
    original_image_url?: string;
  };

  /**
   * Generated text content from the content AI provider.
   * Null until generation completes.
   */
  @Column({ name: 'generated_content', type: 'jsonb', nullable: true })
  generatedContent: {
    title: string;
    meta_title: string;
    meta_description: string;
    short_description: string;
    description: string;
  } | null;

  /**
   * Generated image metadata. Each entry corresponds to one image prompt.
   * Images are stored on disk at file_path.
   * serve_url is the API path to retrieve the image: /api/v1/ai/images/:id/:index
   */
  @Column({ name: 'generated_images', type: 'jsonb', nullable: true })
  generatedImages: Array<{
    filename: string;
    file_path: string;
    serve_url: string;
    mime_type: string;
    prompt_index: number;
    prompt_text: string;
    success: boolean;
    error?: string;
  }> | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: AiProductDataStatus,
    default: AiProductDataStatus.PENDING,
  })
  status: AiProductDataStatus;

  /** Set when status transitions to GENERATED */
  @Column({ name: 'generated_at', type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

// ─── AiGenerationJob ─────────────────────────────────────────────────────────

/**
 * Tracks the async Bull job for each AI generation session.
 * Linked to AiProductData by aiProductDataId.
 */
@Entity('ai_generation_jobs')
@Index(['aiProductDataId'])
export class AiGenerationJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'ai_product_data_id', type: 'uuid' })
  aiProductDataId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: AiGenerationJobStatus,
    default: AiGenerationJobStatus.PENDING,
  })
  status: AiGenerationJobStatus;

  /** Content generation phase: 'pending' | 'completed' | 'failed' */
  @Column({ name: 'content_status', type: 'varchar', length: 20, nullable: true })
  contentStatus: string | null;

  /** Total number of image prompts to process */
  @Column({ name: 'image_total', type: 'int', default: 0 })
  imageTotal: number;

  /** Number of images successfully generated */
  @Column({ name: 'image_completed', type: 'int', default: 0 })
  imageCompleted: number;

  /** Number of image generation failures */
  @Column({ name: 'image_failed', type: 'int', default: 0 })
  imageFailed: number;

  /** Error message if the job failed */
  @Column({ name: 'error', type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
