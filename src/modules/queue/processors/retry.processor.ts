import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES, QUEUE_DEFAULT_OPTIONS } from '../queue.constants';
import { OrdersService } from '../../orders/orders.service';
import { SyncStatus } from '../../../database/entities/order.entity';

@Processor(QUEUE_NAMES.RETRY)
export class RetryProcessor {
  private readonly logger = new Logger(RetryProcessor.name);

  constructor(
    private readonly ordersService: OrdersService,
    @InjectQueue(QUEUE_NAMES.ORDERS)
    private readonly ordersQueue: Queue,
    @InjectQueue(QUEUE_NAMES.INVENTORY)
    private readonly inventoryQueue: Queue,
    @InjectQueue(QUEUE_NAMES.PRICING)
    private readonly pricingQueue: Queue,
  ) {}

  @Process(JOB_NAMES.RETRY_FAILED_JOB)
  async retryFailedJobs(job: Job): Promise<void> {
    this.logger.log('Starting retry of failed jobs...');

    // Retry failed orders
    const failedOrders = await this.ordersService.getFailedOrders(50);
    this.logger.log(`Found ${failedOrders.length} failed orders to retry`);

    for (const order of failedOrders) {
      if (order.retryCount < 5) {
        await this.ordersQueue.add(
          JOB_NAMES.SYNC_ORDER_TO_ERPNEXT,
          { orderId: order.id, source: order.source },
          {
            ...QUEUE_DEFAULT_OPTIONS,
            delay: Math.pow(2, order.retryCount) * 10000, // exponential delay per retry
          },
        );
        this.logger.log(`Requeued order ${order.id} (attempt ${order.retryCount + 1})`);
      } else {
        this.logger.warn(`Order ${order.id} exceeded max retries (${order.retryCount}), skipping`);
      }
    }
  }
}
