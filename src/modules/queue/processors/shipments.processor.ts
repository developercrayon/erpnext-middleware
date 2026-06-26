import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { ERPNextService } from '../../connectors/erpnext/erpnext.service';
import { AmazonConnector } from '../../connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../connectors/flipkart/flipkart.connector';
import { ShipmentSync } from '../../../database/entities/sync.entity';
import { MarketplaceSource } from '../../../database/entities/order.entity';
import { ErrorLog } from '../../../database/entities/logs.entity';
import { OrdersService } from '../../orders/orders.service';

@Processor(QUEUE_NAMES.SHIPMENTS)
export class ShipmentsProcessor {
  private readonly logger = new Logger(ShipmentsProcessor.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly erpnextService: ERPNextService,
    private readonly amazonConnector: AmazonConnector,
    private readonly flipkartConnector: FlipkartConnector,
    @InjectRepository(ShipmentSync)
    private readonly shipmentSyncRepo: Repository<ShipmentSync>,
    @InjectRepository(ErrorLog)
    private readonly errorLogRepo: Repository<ErrorLog>,
  ) {}

  @Process(JOB_NAMES.CREATE_SHIPMENT)
  async createShipment(job: Job): Promise<void> {
    const { orderId, trackingNumber, carrier, carrierService } = job.data;
    this.logger.log(`Creating shipment for order ${orderId}`);

    const order = await this.ordersService.findById(orderId);

    const connector =
      order.source === MarketplaceSource.AMAZON
        ? this.amazonConnector
        : this.flipkartConnector;

    const syncLog = await this.shipmentSyncRepo.save({
      orderId,
      marketplaceOrderId: order.marketplaceOrderId,
      source: order.source,
      trackingNumber,
      carrier,
      carrierService,
      syncStatus: 'IN_PROGRESS',
    });

    try {
      // Confirm shipment on marketplace
      const result = await connector.createShipment({
        orderId,
        marketplaceOrderId: order.marketplaceOrderId,
        trackingNumber,
        carrier,
        carrierService,
        shippedAt: new Date(),
      });

      if (!result.success) {
        throw new Error(result.error);
      }

      // Create Delivery Note in ERPNext
      if (order.erpnextSalesOrderId) {
        const dnId = await this.erpnextService.createDeliveryNote(
          order.erpnextSalesOrderId,
          trackingNumber,
          carrier,
        );
        await this.shipmentSyncRepo.update(syncLog.id, {
          erpnextDeliveryNoteId: dnId,
        });
      }

      await this.shipmentSyncRepo.update(syncLog.id, {
        syncStatus: 'SYNCED',
        shippedAt: new Date(),
      });

      this.logger.log(`Shipment created for order ${orderId}: ${result.data?.shipmentId}`);
    } catch (error) {
      await this.shipmentSyncRepo.update(syncLog.id, {
        syncStatus: 'FAILED',
        errorMessage: error.message,
      });
      throw error;
    }
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    this.logger.error(`Shipment job ${job.id} failed: ${error.message}`);
    await this.errorLogRepo.save({
      source: QUEUE_NAMES.SHIPMENTS,
      context: job.name,
      message: error.message,
      stackTrace: error.stack,
      payload: job.data,
    });
  }
}
