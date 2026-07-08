import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { QueueJob, QueueJobStatus } from '../../database/entities/operational.entity';

@Injectable()
export class QueueService {
  constructor(
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
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
}
