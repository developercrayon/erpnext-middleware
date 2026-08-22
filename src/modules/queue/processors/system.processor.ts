import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { ApiLog, WebhookLog, ConnectorLog, ErrorLog } from '../../../database/entities/logs.entity';
import { ItemSyncLog, SyncHistory, QueueJob } from '../../../database/entities/operational.entity';

@Processor(QUEUE_NAMES.SYSTEM)
export class SystemProcessor {
  private readonly logger = new Logger(SystemProcessor.name);

  constructor(
    @InjectRepository(ApiLog) private readonly apiLogRepo: Repository<ApiLog>,
    @InjectRepository(WebhookLog) private readonly webhookLogRepo: Repository<WebhookLog>,
    @InjectRepository(ConnectorLog) private readonly connectorLogRepo: Repository<ConnectorLog>,
    @InjectRepository(ErrorLog) private readonly errorLogRepo: Repository<ErrorLog>,
    @InjectRepository(ItemSyncLog) private readonly itemSyncLogRepo: Repository<ItemSyncLog>,
    @InjectRepository(QueueJob) private readonly queueJobRepo: Repository<QueueJob>,
    @InjectRepository(SyncHistory) private readonly syncHistoryRepo: Repository<SyncHistory>,
  ) {}

  @Process(JOB_NAMES.CLEAR_LOGS)
  async clearLogs(job: Job): Promise<void> {
    this.logger.log('Starting scheduled log cleanup job...');
    
    // Clear logs created before the start of the current day (00:00:00)
    // This keeps logs from today's morning, but deletes yesterday's and older logs.
    const cutoffDate = new Date();
    cutoffDate.setHours(0, 0, 0, 0);

    const condition = { createdAt: LessThan(cutoffDate) };

    try {
      const results = await Promise.all([
        this.apiLogRepo.delete(condition),
        this.webhookLogRepo.delete(condition),
        this.connectorLogRepo.delete(condition),
        this.errorLogRepo.delete(condition),
        this.itemSyncLogRepo.delete(condition),
        this.queueJobRepo.delete({ createdDate: LessThan(cutoffDate) }), // QueueJob uses createdDate instead of createdAt
        this.syncHistoryRepo.delete(condition),
      ]);

      this.logger.log(`Log cleanup completed successfully. Records deleted:
        ApiLogs: ${results[0].affected}
        WebhookLogs: ${results[1].affected}
        ConnectorLogs: ${results[2].affected}
        ErrorLogs: ${results[3].affected}
        ItemSyncLogs: ${results[4].affected}
        QueueJobs: ${results[5].affected}
        SyncHistory: ${results[6].affected}
      `);
    } catch (error) {
      this.logger.error(`Failed to clear logs: ${error.message}`);
      throw error;
    }
  }
}
