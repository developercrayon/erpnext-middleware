import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES } from './queue.constants';
import { QueueJob, QueueJobStatus } from '../../database/entities/operational.entity';

@Injectable()
export class QueueListenerService implements OnModuleInit {
  private readonly logger = new Logger(QueueListenerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ORDERS) private readonly ordersQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PRODUCTS) private readonly productsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.INVENTORY) private readonly inventoryQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PRICING) private readonly pricingQueue: Queue,
    @InjectQueue(QUEUE_NAMES.SHIPMENTS) private readonly shipmentsQueue: Queue,
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
  ) {}

 onModuleInit() {
    const queues = [
      { name: QUEUE_NAMES.ORDERS, queue: this.ordersQueue },
      { name: QUEUE_NAMES.PRODUCTS, queue: this.productsQueue },
      { name: QUEUE_NAMES.INVENTORY, queue: this.inventoryQueue },
      { name: QUEUE_NAMES.PRICING, queue: this.pricingQueue },
      { name: QUEUE_NAMES.SHIPMENTS, queue: this.shipmentsQueue },
    ];

    for (const { name, queue } of queues) {
      // Use global events to catch status changes across different Node instances or workers
      queue.on('global:waiting', (jobId: string) => this.handleGlobalEvent(name, queue, jobId, QueueJobStatus.WAITING));
      queue.on('global:active', (jobId: string) => this.handleGlobalEvent(name, queue, jobId, QueueJobStatus.ACTIVE));
      queue.on('global:completed', (jobId: string) => this.handleGlobalEvent(name, queue, jobId, QueueJobStatus.COMPLETED));
      queue.on('global:failed', (jobId: string, err: string) => this.handleGlobalEvent(name, queue, jobId, QueueJobStatus.FAILED, err));
    }
    
    this.logger.log('Queue listeners initialized');
  }

  private async saveJobRecord(queueName: string, job: any, updateData: Partial<QueueJob>) {
    try {
      const bullJobId = String(job?.id || updateData['bullJobId'] || '');
      if (!bullJobId) return;

      const dataToSave = {
        bullJobId,
        queueName,
        jobName: job?.name || 'unknown',
        attempts: job?.attemptsMade ?? 0,
        maxAttempts: job?.opts?.attempts || 3,
        ...updateData,
      };

      await this.queueJobRepo.upsert(dataToSave, ['bullJobId', 'queueName']);
      this.logger.debug(`Job record saved: ${bullJobId} [${queueName}] -> ${updateData['status']}`);
    } catch (err) {
      this.logger.error(`Error saving job record to database: ${err.message}`);
    }
  }

  private async handleGlobalEvent(queueName: string, queue: Queue, jobId: string, status: QueueJobStatus, errorMsg?: string) {
    let job;
    try {
      job = await queue.getJob(jobId);
    } catch (e) {
      // If job is already removed or inaccessible, we fall back
    }

    const updateData: Partial<QueueJob> = { status };
    if (status === QueueJobStatus.ACTIVE) updateData.processedAt = new Date();
    if (status === QueueJobStatus.COMPLETED || status === QueueJobStatus.FAILED) {
      updateData.completedAt = new Date();
    }
    if (status === QueueJobStatus.FAILED && errorMsg) {
      updateData.errorMessage = errorMsg;
    }

    if (job) {
      await this.saveJobRecord(queueName, job, updateData);
    } else {
      await this.saveJobRecord(queueName, { id: jobId, name: 'unknown' }, updateData);
    }
  }
}
