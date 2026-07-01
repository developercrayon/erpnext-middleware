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
      // Use local (non-global) events so we have access to the full Job object
      queue.on('waiting', (jobId: string) => this.handleWaiting(name, queue, jobId));
      queue.on('active', (job: any) => this.handleActive(name, job));
      queue.on('completed', (job: any) => this.handleCompleted(name, job));
      queue.on('failed', (job: any, error: Error) => this.handleFailed(name, job, error?.message || 'Unknown error'));
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

  private async handleWaiting(queueName: string, queue: Queue, jobId: string) {
    // For waiting, we only have the jobId — fetch the full job object
    const job = await queue.getJob(jobId);
    if (job) {
      await this.saveJobRecord(queueName, job, { status: QueueJobStatus.WAITING });
    } else {
      // Fallback: save minimal record without fetching
      await this.saveJobRecord(queueName, { id: jobId, name: 'unknown', attemptsMade: 0, opts: {} }, { status: QueueJobStatus.WAITING });
    }
  }

  private async handleActive(queueName: string, job: any) {
    await this.saveJobRecord(queueName, job, { status: QueueJobStatus.ACTIVE, processedAt: new Date() });
  }

  private async handleCompleted(queueName: string, job: any) {
    await this.saveJobRecord(queueName, job, { 
      status: QueueJobStatus.COMPLETED, 
      completedAt: new Date()
    });
  }

  private async handleFailed(queueName: string, job: any, error: string) {
    await this.saveJobRecord(queueName, job, { 
      status: QueueJobStatus.FAILED, 
      errorMessage: error,
      completedAt: new Date()
    });
  }
}
