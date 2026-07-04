import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Inventory } from '../../database/entities/inventory.entity';
import { ERPNextService } from '../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../connectors/flipkart/flipkart.connector';
import { QUEUE_NAMES, JOB_NAMES, QUEUE_DEFAULT_OPTIONS } from '../queue/queue.constants';
import { MarketplaceSource } from '../../database/entities/order.entity';
import { InventoryQueryDto } from './dto/inventory.dto';
import { ConfigService } from '@nestjs/config';
import { QueueJob, QueueJobStatus, ItemSyncLog, SyncResourceType } from '../../database/entities/operational.entity';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepo: Repository<Inventory>,
    @InjectRepository(ItemSyncLog)
    private readonly itemSyncLogRepo: Repository<ItemSyncLog>,
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.INVENTORY)
    private readonly inventoryQueue: Queue,
    @InjectRepository(QueueJob)
    private readonly queueJobRepo: Repository<QueueJob>,
  ) {}

  // ─── Query Methods ────────────────────────────────────────────────────────

  async findAll(query: InventoryQueryDto): Promise<{ data: Inventory[]; total: number }> {
    const { source, sku, warehouse, page = 1, pageSize = 20 } = query;

    const where: any = {};
    if (source) where.source = source;
    if (sku) where.sku = sku;
    if (warehouse) where.warehouse = warehouse;

    const options: FindManyOptions<Inventory> = {
      where,
      order: { updatedAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    const [data, total] = await this.inventoryRepo.findAndCount(options);
    return { data, total };
  }

  async findBySku(sku: string): Promise<Inventory[]> {
    return this.inventoryRepo.find({ where: { sku }, order: { updatedAt: 'DESC' } });
  }

  // ─── Sync Trigger ─────────────────────────────────────────────────────────

  async triggerSync(source?: MarketplaceSource, skus?: string[], warehouse?: string): Promise<string> {
    const job = await this.inventoryQueue.add(
      JOB_NAMES.SYNC_INVENTORY_TO_MARKETPLACE,
      { source, skus, warehouse },
      QUEUE_DEFAULT_OPTIONS,
    );
    
    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.INVENTORY,
        jobName: JOB_NAMES.SYNC_INVENTORY_TO_MARKETPLACE,
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: job.opts?.attempts || 3,
      });
    } catch (e) {}

    this.logger.log(`Inventory sync job queued: ${job.id}`);
    return String(job.id);
  }

  async triggerFetch(skus?: string[]): Promise<string> {
    const job = await this.inventoryQueue.add(
      JOB_NAMES.FETCH_INVENTORY_FROM_ERPNEXT,
      { skus },
      QUEUE_DEFAULT_OPTIONS,
    );
    
    try {
      await this.queueJobRepo.insert({
        bullJobId: String(job.id),
        queueName: QUEUE_NAMES.INVENTORY,
        jobName: JOB_NAMES.FETCH_INVENTORY_FROM_ERPNEXT,
        status: QueueJobStatus.WAITING,
        attempts: 0,
        maxAttempts: job.opts?.attempts || 3,
        createdDate: new Date(),
      });
    } catch (e) {}

    this.logger.log(`Inventory fetch job queued: ${job.id}`);
    return String(job.id);
  }

  // ─── Real-time Inventory from ERPNext ─────────────────────────────────────

  /**
   * Fetches inventory for the given SKUs from ERPNext and updates local records.
   */
  async refreshFromERPNext(skus: string[], warehouse?: string): Promise<Record<string, number>> {
    const wh = warehouse || this.config.get<string>('erpnext.defaultWarehouse');
    const inventoryMap = await this.erpnextService.getInventoryForSkus(skus, wh);

    for (const [sku, qty] of Object.entries(inventoryMap)) {
      await this.inventoryRepo.upsert(
        {
          sku,
          warehouse: wh,
          source: null,
          actualQty: qty,
          availableQty: qty,
          lastSyncedAt: new Date(),
        },
        ['sku', 'warehouse', 'source'],
      );
    }

    return inventoryMap;
  }

  // ─── Push to Marketplace ──────────────────────────────────────────────────

  /**
   * Pushes inventory from ERPNext directly to a marketplace (online call, no queue).
   */
  async pushToMarketplace(
    source: MarketplaceSource,
    skus: string[],
    warehouse?: string,
  ): Promise<{ success: number; failed: number }> {
    const inventoryMap = await this.refreshFromERPNext(skus, warehouse);

    const items = Object.entries(inventoryMap).map(([sku, qty]) => ({
      sku,
      warehouse: warehouse || this.config.get<string>('erpnext.defaultWarehouse'),
      availableQty: qty,
    }));

    const connector =
      source === MarketplaceSource.AMAZON ? this.amazonConnector : this.flipkartConnector;

    const result = await connector.updateInventory(items);
    return {
      success: result.data?.success || 0,
      failed: result.data?.failed || 0,
    };
  }

  // ─── Sync History ─────────────────────────────────────────────────────────

  async getSyncHistory(limit = 50): Promise<ItemSyncLog[]> {
    return this.itemSyncLogRepo.find({
      where: { resourceType: SyncResourceType.INVENTORY },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(): Promise<Record<string, any>> {
    const total = await this.inventoryRepo.count();
    const lowStock = await this.inventoryRepo
      .createQueryBuilder('inv')
      .where('inv.availableQty <= :threshold', { threshold: 5 })
      .getCount();
    const outOfStock = await this.inventoryRepo
      .createQueryBuilder('inv')
      .where('inv.availableQty <= 0')
      .getCount();
    const amazon = await this.inventoryRepo.count({
      where: { source: MarketplaceSource.AMAZON },
    });
    const flipkart = await this.inventoryRepo.count({
      where: { source: MarketplaceSource.FLIPKART },
    });

    return { total, lowStock, outOfStock, amazon, flipkart };
  }
}
