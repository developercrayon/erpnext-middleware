import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { QueueJob } from '../../database/entities/operational.entity';
import { QUEUE_NAMES } from './queue.constants';

@Injectable()
export class QueueService {
  constructor(
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
    @InjectQueue(QUEUE_NAMES.PRODUCTS) private readonly productsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.ORDERS) private readonly ordersQueue: Queue,
    @InjectQueue(QUEUE_NAMES.INVENTORY) private readonly inventoryQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PRICING) private readonly pricingQueue: Queue,
    @InjectQueue(QUEUE_NAMES.SHIPMENTS) private readonly shipmentsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RETRY) private readonly retryQueue: Queue,
  ) {}

  async getQueueJobs(query: any): Promise<{ data: QueueJob[]; total: number }> {
    const { status, queueName, page = 1, pageSize = 50 } = query;

    const where: any = {};
    if (status) where.status = status;
    if (queueName) where.queueName = queueName;

    const options: FindManyOptions<QueueJob> = {
      where,
      order: { createdDate: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    const [data, total] = await this.queueJobRepo.findAndCount(options);
    return { data, total };
  }

  async getQueueJobById(id: string): Promise<QueueJob> {
    const job = await this.queueJobRepo.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Queue job ${id} not found`);
    }
    return job;
  }

  async deleteQueueJobs(ids: string[]): Promise<void> {
    await this.queueJobRepo.delete(ids);
  }

  async drainAll(): Promise<{ message: string; queues: string[] }> {
    const allQueues: Queue[] = [
      this.productsQueue,
      this.ordersQueue,
      this.inventoryQueue,
      this.pricingQueue,
      this.shipmentsQueue,
      this.retryQueue,
    ];

    const drained: string[] = [];
    for (const q of allQueues) {
      try {
        // empty() removes all waiting jobs; clean() removes completed/failed/active/delayed jobs
        await q.empty();
        await q.clean(0, 'completed');
        await q.clean(0, 'failed');
        await q.clean(0, 'active');
        await q.clean(0, 'delayed');
        await q.clean(0, 'paused');
        drained.push(q.name);
      } catch (e) {
        // log but don't throw — attempt to drain remaining queues
        drained.push(`${q.name} (partial)`);
      }
    }

    return { message: 'All queues drained successfully', queues: drained };
  }
}
