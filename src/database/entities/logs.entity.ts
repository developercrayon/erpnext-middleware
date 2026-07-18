import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export enum ConnectorType {
  ERPNEXT = 'ERPNEXT',
  AMAZON = 'AMAZON',
  FLIPKART = 'FLIPKART',
}

@Entity('connector_logs')
@Index(['connector', 'createdAt'])
export class ConnectorLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'connector', type: 'enum', enum: ConnectorType })
  connector: ConnectorType;

  @Column({ name: 'action', type: 'varchar' })
  action: string;

  @Column({ name: 'level', type: 'enum', enum: LogLevel, default: LogLevel.INFO })
  level: LogLevel;

  @Column({ name: 'message', type: 'text' })
  message: string;

  @Column({ name: 'request_payload', type: 'jsonb', nullable: true })
  requestPayload: Record<string, any>;

  @Column({ name: 'response_payload', type: 'jsonb', nullable: true })
  responsePayload: Record<string, any>;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number;

  @Column({ name: 'status_code', type: 'int', nullable: true })
  statusCode: number;

  @Column({ name: 'error', type: 'text', nullable: true })
  error: string;

  @Column({ name: 'correlation_id', type: 'varchar', nullable: true })
  correlationId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('webhook_logs')
@Index(['source', 'createdAt'])
export class WebhookLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source', type: 'varchar' })
  source: string;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType: string;

  @Column({ name: 'headers', type: 'jsonb', nullable: true })
  headers: Record<string, any>;

  @Column({ name: 'raw_payload', type: 'jsonb' })
  rawPayload: Record<string, any>;

  @Column({ name: 'signature_valid', type: 'boolean', default: false })
  signatureValid: boolean;

  @Column({ name: 'processed', type: 'boolean', default: false })
  processed: boolean;

  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processingError: string;

  @Column({ name: 'queue_job_id', type: 'varchar', nullable: true })
  queueJobId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('api_logs')
@Index(['service', 'createdAt'])
export class ApiLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'service', type: 'varchar' })
  service: string;

  @Column({ name: 'method', type: 'varchar', length: 10 })
  method: string;

  @Column({ name: 'url', type: 'text' })
  url: string;

  @Column({ name: 'request_headers', type: 'jsonb', nullable: true })
  requestHeaders: Record<string, any>;

  @Column({ name: 'request_body', type: 'jsonb', nullable: true })
  requestBody: Record<string, any>;

  @Column({ name: 'response_status', type: 'int', nullable: true })
  responseStatus: number;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody: Record<string, any>;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number;

  @Column({ name: 'error', type: 'text', nullable: true })
  error: string;

  @Column({ name: 'correlation_id', type: 'varchar', nullable: true })
  correlationId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('error_logs_v2')
@Index(['source', 'resolved'])
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

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
