import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum SyncResourceType {
  ORDER = 'ORDER',
  PRODUCT = 'PRODUCT',
  INVENTORY = 'INVENTORY',
  PRICE = 'PRICE',
  SHIPMENT = 'SHIPMENT',
}

@Entity('sync_history')
@Index(['resourceType', 'source', 'createdAt'])
export class SyncHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'resource_type', type: 'enum', enum: SyncResourceType })
  resourceType: SyncResourceType;

  @Column({ name: 'source', type: 'varchar' })
  source: string;

  @Column({ name: 'resource_id', type: 'varchar', nullable: true })
  resourceId: string;

  @Column({ name: 'status', type: 'varchar' })
  status: string;

  @Column({ name: 'items_total', type: 'int', default: 0 })
  itemsTotal: number;

  @Column({ name: 'items_synced', type: 'int', default: 0 })
  itemsSynced: number;

  @Column({ name: 'items_failed', type: 'int', default: 0 })
  itemsFailed: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number;

  @Column({ name: 'error', type: 'text', nullable: true })
  error: string;

  @Column({ name: 'meta', type: 'jsonb', nullable: true })
  meta: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

export enum QueueJobStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DELAYED = 'DELAYED',
  STALLED = 'STALLED',
}

@Entity('queue_jobs')
@Index(['queueName', 'status', 'createdAt'])
export class QueueJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'bull_job_id', type: 'varchar', nullable: true })
  bullJobId: string;

  @Column({ name: 'queue_name', type: 'varchar' })
  queueName: string;

  @Column({ name: 'job_name', type: 'varchar' })
  jobName: string;

  @Column({ name: 'status', type: 'enum', enum: QueueJobStatus, default: QueueJobStatus.WAITING })
  status: QueueJobStatus;

  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload: Record<string, any>;

  @Column({ name: 'result', type: 'jsonb', nullable: true })
  result: Record<string, any>;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'max_attempts', type: 'int', default: 3 })
  maxAttempts: number;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('error_logs')
@Index(['source', 'createdAt'])
export class ErrorLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source', type: 'varchar' })
  source: string;

  @Column({ name: 'context', type: 'varchar', nullable: true })
  context: string;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({ name: 'stack_trace', type: 'text', nullable: true })
  stackTrace: string;

  @Column({ name: 'payload', type: 'jsonb', nullable: true })
  payload: Record<string, any>;

  @Column({ name: 'resolved', type: 'boolean', default: false })
  resolved: boolean;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date;

  @Column({ name: 'correlation_id', type: 'varchar', nullable: true })
  correlationId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('settings')
@Index(['key'], { unique: true })
export class Settings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'key', type: 'varchar', unique: true })
  key: string;

  @Column({ name: 'value', type: 'text' })
  value: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string;

  @Column({ name: 'is_encrypted', type: 'boolean', default: false })
  isEncrypted: boolean;

  @Column({ name: 'group', type: 'varchar', nullable: true })
  group: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
