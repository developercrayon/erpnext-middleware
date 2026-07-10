import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, Between } from 'typeorm';
import {
  ConnectorLog,
  WebhookLog,
  ApiLog,
  ErrorLog,
} from '../../database/entities/logs.entity';
import { SyncHistory, ItemSyncLog } from '../../database/entities/operational.entity';
import { LogQueryDto, ErrorLogQueryDto, SyncHistoryQueryDto, ItemSyncLogQueryDto } from './dto/log.dto';

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);

  constructor(
    @InjectRepository(ConnectorLog)
    private readonly connectorLogRepo: Repository<ConnectorLog>,
    @InjectRepository(WebhookLog)
    private readonly webhookLogRepo: Repository<WebhookLog>,
    @InjectRepository(ApiLog)
    private readonly apiLogRepo: Repository<ApiLog>,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
    @InjectRepository(SyncHistory)
    private readonly syncHistoryRepo: Repository<SyncHistory>,
    @InjectRepository(ItemSyncLog)
    private readonly itemSyncLogRepo: Repository<ItemSyncLog>,
  ) {}

  // ─── Connector Logs ───────────────────────────────────────────────────────

  async getConnectorLogs(query: LogQueryDto): Promise<{ data: ConnectorLog[]; total: number }> {
    const { source, level, fromDate, toDate, page = 1, pageSize = 50 } = query;

    const where: any = {};
    if (source) where.connector = source;
    if (level) where.level = level;

    const options: FindManyOptions<ConnectorLog> = {
      where,
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    if (fromDate && toDate) {
      options.where = { ...where, createdAt: Between(new Date(fromDate), new Date(toDate)) };
    }

    const [data, total] = await this.connectorLogRepo.findAndCount(options);
    return { data, total };
  }

  // ─── Webhook Logs ─────────────────────────────────────────────────────────

  async getWebhookLogs(query: LogQueryDto): Promise<{ data: WebhookLog[]; total: number }> {
    const { source, fromDate, toDate, page = 1, pageSize = 50 } = query;

    const where: any = {};
    if (source) where.source = source;

    const options: FindManyOptions<WebhookLog> = {
      where,
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    if (fromDate && toDate) {
      options.where = { ...where, createdAt: Between(new Date(fromDate), new Date(toDate)) };
    }

    const [data, total] = await this.webhookLogRepo.findAndCount(options);
    return { data, total };
  }

  // ─── API Logs ─────────────────────────────────────────────────────────────

  async getApiLogs(query: LogQueryDto): Promise<{ data: ApiLog[]; total: number }> {
    const { source, fromDate, toDate, page = 1, pageSize = 50 } = query;

    const where: any = {};
    if (source) where.service = source;

    const options: FindManyOptions<ApiLog> = {
      where,
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    if (fromDate && toDate) {
      options.where = { ...where, createdAt: Between(new Date(fromDate), new Date(toDate)) };
    }

    const [data, total] = await this.apiLogRepo.findAndCount(options);
    return { data, total };
  }

  // ─── Error Logs ───────────────────────────────────────────────────────────

  async getErrorLogs(query: ErrorLogQueryDto): Promise<{ data: ErrorLog[]; total: number }> {
    const { resolved, source, page = 1, pageSize = 50 } = query;

    const where: any = {};
    if (resolved !== undefined) where.resolved = resolved;
    if (source) where.source = source;

    const options: FindManyOptions<ErrorLog> = {
      where,
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    const [data, total] = await this.errorLogRepo.findAndCount(options);
    return { data, total };
  }

  async getErrorLogById(id: string): Promise<ErrorLog> {
    const errorLog = await this.errorLogRepo.findOne({ where: { id } });
    if (!errorLog) {
      throw new NotFoundException(`Error log ${id} not found`);
    }
    return errorLog;
  }

  async deleteErrorLogs(ids: string[]): Promise<void> {
    await this.errorLogRepo.delete(ids);
  }

  async resolveError(id: string): Promise<ErrorLog> {
    const errorLog = await this.errorLogRepo.findOne({ where: { id } });
    if (!errorLog) {
      throw new NotFoundException(`Error log ${id} not found`);
    }

    errorLog.resolved = true;
    errorLog.resolvedAt = new Date();
    return this.errorLogRepo.save(errorLog);
  }

  // ─── Sync History ─────────────────────────────────────────────────────────

  async getSyncHistory(query: SyncHistoryQueryDto): Promise<{ data: SyncHistory[]; total: number }> {
    const { resourceType, source, page = 1, pageSize = 20 } = query;

    const where: any = {};
    if (resourceType) where.resourceType = resourceType;
    if (source) where.source = source;

    const options: FindManyOptions<SyncHistory> = {
      where,
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    const [data, total] = await this.syncHistoryRepo.findAndCount(options);
    return { data, total };
  }

  async deleteSyncHistory(ids: string[]): Promise<void> {
    await this.syncHistoryRepo.delete(ids);
  }

  async getItemSyncLogs(query: ItemSyncLogQueryDto): Promise<{ data: ItemSyncLog[]; total: number }> {
    const { resourceType, source, syncStatus, referenceId, page = 1, pageSize = 20 } = query;

    const where: any = {};
    if (resourceType) where.resourceType = resourceType;
    if (source) where.source = source;
    if (syncStatus) where.syncStatus = syncStatus;
    if (referenceId) where.referenceId = referenceId;

    const options: FindManyOptions<ItemSyncLog> = {
      where,
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    const [data, total] = await this.itemSyncLogRepo.findAndCount(options);
    return { data, total };
  }

  async deleteItemSyncLogs(ids: string[]): Promise<void> {
    await this.itemSyncLogRepo.delete(ids);
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(): Promise<Record<string, any>> {
    const totalErrors = await this.errorLogRepo.count();
    const unresolvedErrors = await this.errorLogRepo.count({ where: { resolved: false } });
    const totalWebhooks = await this.webhookLogRepo.count();
    const failedWebhooks = await this.webhookLogRepo.count({ where: { processed: false } });

    return { totalErrors, unresolvedErrors, totalWebhooks, failedWebhooks };
  }

  /**
   * Helper to clean up old logs
   */
  async cleanupOldLogs(daysToKeep = 30): Promise<void> {
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - daysToKeep);

    // This would typically use TypeORM QueryBuilder for raw deletes
    this.logger.log(`Cleaning up logs older than ${daysToKeep} days...`);
    // Example: await this.connectorLogRepo.delete({ createdAt: LessThan(dateLimit) });
  }
}
