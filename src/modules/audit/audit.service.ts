import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities/audit-log.entity';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(
    entityType: string,
    entityId: string,
    action: string,
    details?: string,
    metadata?: any,
    user: string = 'System',
  ): Promise<AuditLog> {
    const entry = this.auditRepo.create({
      entity_type: entityType,
      entity_id: entityId,
      action,
      details,
      metadata,
      user,
    });
    this.logger.log(`[AUDIT] ${entityType}:${entityId} -> ${action}: ${details || ''}`);
    return this.auditRepo.save(entry);
  }

  async getLogsByEntity(entityType: string, entityId: string): Promise<AuditLog[]> {
    return this.auditRepo.find({
      where: { entity_type: entityType, entity_id: entityId },
      order: { timestamp: 'ASC' },
    });
  }

  async getRecentLogs(limit = 50): Promise<AuditLog[]> {
    return this.auditRepo.find({
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }
}
