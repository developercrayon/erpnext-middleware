import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERPNextConnector, CreateSalesOrderDto, CreateCustomerDto } from './erpnext.connector';
import { NormalizedOrder } from '../base/connector.types';
import { MarketplaceSource } from '../../../database/entities/order.entity';

/**
 * ERPNextService wraps the ERPNextConnector to provide
 * high-level, business-oriented operations for use
 * by other modules (orders, inventory, pricing, etc.)
 */
@Injectable()
export class ERPNextService {
  constructor(
    private readonly connector: ERPNextConnector,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates a full Sales Order in ERPNext from a normalized marketplace order.
   * Also creates or fetches the customer record.
   */
  async syncOrderToERPNext(order: NormalizedOrder): Promise<string> {
    const company = this.config.get<string>('erpnext.company');
    const defaultWarehouse = this.config.get<string>('erpnext.defaultWarehouse');

    // Ensure customer exists
    const customerResult = await this.connector.getOrCreateCustomer({
      name: order.customerName,
      email: order.customerEmail,
      phone: order.customerPhone,
    });

    if (!customerResult.success) {
      throw new Error(`Failed to sync customer: ${customerResult.error}`);
    }

    const customerName = customerResult.data?.name || order.customerName;

    // Build Sales Order payload
    const orderDate = order.orderDate
      ? new Date(order.orderDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];

    const soPayload: CreateSalesOrderDto = {
      customer: customerName,
      company,
      order_type: 'Sales',
      transaction_date: orderDate,
      delivery_date: order.promisedDeliveryDate
        ? new Date(order.promisedDeliveryDate).toISOString().split('T')[0]
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      items: order.items.map((item) => ({
        item_code: item.sku,
        item_name: item.productName,
        qty: item.quantity,
        rate: item.unitPrice,
        warehouse: defaultWarehouse,
        discount_percentage: item.discount ? (item.discount / item.unitPrice) * 100 : 0,
      })),
      custom_marketplace_order_id: order.marketplaceOrderId,
      custom_marketplace_source: order.source,
    };

    const result = await this.connector.createSalesOrder(soPayload);
    if (!result.success) {
      throw new Error(`Failed to create Sales Order: ${result.error}`);
    }

    return result.data?.name;
  }

  /**
   * Fetches all inventory for given SKUs from ERPNext
   */
  async getInventoryForSkus(
    skus: string[],
    warehouse?: string,
  ): Promise<Record<string, number>> {
    const inventoryMap: Record<string, number> = {};
    const wh = warehouse || this.config.get<string>('erpnext.defaultWarehouse');

    await Promise.all(
      skus.map(async (sku) => {
        const result = await this.connector.getItemStock(sku, wh);
        if (result.success && result.data !== undefined) {
          inventoryMap[sku] = parseFloat(result.data) || 0;
        }
      }),
    );

    return inventoryMap;
  }

  /**
   * Fetches prices from ERPNext for given SKUs
   */
  async getPricesForSkus(skus: string[], priceList?: string): Promise<Record<string, number>> {
    const priceMap: Record<string, number> = {};

    await Promise.all(
      skus.map(async (sku) => {
        const result = await this.connector.getItemPrice(sku, priceList);
        if (result.success && result.data) {
          priceMap[sku] = parseFloat(result.data.price_list_rate) || 0;
        }
      }),
    );

    return priceMap;
  }

  /**
   * Creates a Delivery Note in ERPNext for a shipped order
   */
  async createDeliveryNote(
    salesOrderId: string,
    trackingNumber: string,
    carrier: string,
  ): Promise<string> {
    const soResult = await this.connector.getSalesOrder(salesOrderId);
    if (!soResult.success) {
      throw new Error(`Sales Order not found: ${salesOrderId}`);
    }

    const dnPayload = {
      doctype: 'Delivery Note',
      posting_date: new Date().toISOString().split('T')[0],
      customer: soResult.data?.customer,
      items: soResult.data?.items?.map((item: any) => ({
        item_code: item.item_code,
        qty: item.qty,
        rate: item.rate,
        against_sales_order: salesOrderId,
      })),
      lr_no: trackingNumber,
      transporter_name: carrier,
    };

    const result = await this.connector.createDeliveryNote(dnPayload);
    if (!result.success) {
      throw new Error(`Failed to create Delivery Note: ${result.error}`);
    }

    return result.data?.name;
  }

  async cancelSalesOrder(salesOrderId: string): Promise<void> {
    const result = await this.connector.cancelSalesOrder(salesOrderId);
    if (!result.success) {
      throw new Error(`Failed to cancel Sales Order: ${result.error}`);
    }
  }

  async healthCheck() {
    return this.connector.healthCheck();
  }

  async authenticate() {
    return this.connector.authenticate();
  }

  /**
   * Fetches products from ERPNext via the connector
   */
  async fetchProducts(params?: { pageSize?: number; sku?: string }) {
    return this.connector.fetchProducts(params);
  }

  async updateItem(itemCode: string, fields: Record<string, any>): Promise<any> {
    const result = await this.connector.updateItem(itemCode, fields);
    if (!result.success) {
      throw new Error(`Failed to update ERPNext item: ${result.error}`);
    }
    return result.data;
  }

  async getReferenceData(): Promise<any> {
    const result = await this.connector.getReferenceData();
    if (!result.success) {
      throw new Error(`Failed to fetch reference data: ${result.error}`);
    }
    return result.data;
  }

  async deleteItem(itemCode: string): Promise<any> {
    const result = await this.connector.deleteItem(itemCode);
    if (!result.success) {
      throw new Error(`Failed to delete ERPNext item: ${result.error}`);
    }
    return result.data;
  }
}
