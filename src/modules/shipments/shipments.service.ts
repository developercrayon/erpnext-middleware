import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

import { ERPNextService } from '../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../connectors/flipkart/flipkart.connector';
import { OrdersService } from '../orders/orders.service';
import { QUEUE_NAMES, JOB_NAMES, QUEUE_DEFAULT_OPTIONS } from '../queue/queue.constants';
import { MarketplaceSource } from '../../database/entities/order.entity';
import { SyncResourceType, ItemSyncLog } from '../../database/entities/operational.entity';
import { CreateShipmentDto, ShipmentQueryDto } from './dto/shipment.dto';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    @InjectRepository(ItemSyncLog)
    private readonly shipmentSyncRepo: Repository<ItemSyncLog>,
    private readonly erpnextService: ERPNextService,
    private readonly ordersService: OrdersService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectQueue(QUEUE_NAMES.SHIPMENTS)
    private readonly shipmentsQueue: Queue,
  ) {}

  // ─── Query Methods ────────────────────────────────────────────────────────

  async findAll(query: ShipmentQueryDto): Promise<{ data: ItemSyncLog[]; total: number }> {
    const { source, syncStatus, page = 1, pageSize = 20 } = query;

    const where: any = { resourceType: SyncResourceType.SHIPMENT };
    if (source) where.source = source;
    if (syncStatus) where.syncStatus = syncStatus;

    const options: FindManyOptions<ItemSyncLog> = {
      where,
      order: { createdAt: 'DESC' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    };

    const [data, total] = await this.shipmentSyncRepo.findAndCount(options);
    return { data, total };
  }

  async findById(id: string): Promise<ItemSyncLog | null> {
    return this.shipmentSyncRepo.findOne({ where: { id } });
  }

  async findByOrderId(orderId: string): Promise<ItemSyncLog[]> {
    return this.shipmentSyncRepo.find({ where: { referenceId: orderId, resourceType: SyncResourceType.SHIPMENT } });
  }

  // ─── Sync Trigger ─────────────────────────────────────────────────────────

  /**
   * Enqueues a job to create a shipment on the marketplace and generate a
   * Delivery Note in ERPNext.
   */
  async createShipment(dto: CreateShipmentDto): Promise<string> {
    const order = await this.ordersService.findById(dto.orderId);
    if (!order) {
      throw new NotFoundException(`Order ${dto.orderId} not found`);
    }

    const job = await this.shipmentsQueue.add(
      JOB_NAMES.CREATE_SHIPMENT,
      {
        orderId: dto.orderId,
        trackingNumber: dto.trackingNumber,
        carrier: dto.carrier,
        carrierService: dto.carrierService,
      },
      QUEUE_DEFAULT_OPTIONS,
    );
    this.logger.log(`Shipment creation job queued: ${job.id}`);
    return String(job.id);
  }

  // ─── Direct Operations ────────────────────────────────────────────────────

  /**
   * Fetches the latest shipment status from the marketplace.
   * Useful for tracking updates.
   */
  async syncShipmentStatus(shipmentId: string): Promise<void> {
    const shipment = await this.findById(shipmentId);
    if (!shipment) {
      throw new NotFoundException(`Shipment ${shipmentId} not found`);
    }

    // Usually involves a connector call to fetch latest tracking details
    this.logger.log(`Syncing status for shipment ${shipmentId}`);
    // Implementation depends on specific marketplace API support for tracking status
  }

  // ─── Stats ────────────────────────────────────────────────────────────────

  async getStats(): Promise<Record<string, any>> {
    const total = await this.shipmentSyncRepo.count({ where: { resourceType: SyncResourceType.SHIPMENT } });
    const amazon = await this.shipmentSyncRepo.count({
      where: { source: MarketplaceSource.AMAZON, resourceType: SyncResourceType.SHIPMENT },
    });
    const flipkart = await this.shipmentSyncRepo.count({
      where: { source: MarketplaceSource.FLIPKART, resourceType: SyncResourceType.SHIPMENT },
    });
    const pending = await this.shipmentSyncRepo.count({
      where: { syncStatus: 'PENDING', resourceType: SyncResourceType.SHIPMENT },
    });
    const failed = await this.shipmentSyncRepo.count({
      where: { syncStatus: 'FAILED', resourceType: SyncResourceType.SHIPMENT },
    });

    return { total, amazon, flipkart, pending, failed };
  }
}
