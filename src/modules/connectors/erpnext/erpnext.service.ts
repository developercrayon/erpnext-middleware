import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERPNextConnector } from './erpnext.connector';
import { Order, MarketplaceSource } from '../../../database/entities/order.entity';
import { OrderFieldMapping } from '../../../database/entities/order-field-mapping.entity';
import { evaluateTemplate } from '../../../common/utils/template.util';
import * as path from 'path';

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
  ) { }

  /**
   * Creates a full Sales Order in ERPNext from a normalized marketplace order.
   * Also creates or fetches the customer record.
   */
  async syncOrderToERPNext(order: Order, mappings: OrderFieldMapping[]): Promise<string> {
    const company = this.config.get<string>('erpnext.company') || 'Woodwolf Studio (O) Pvt. Ltd';
    let raw = order.rawPayload || {};
    // Unwrap the payload if it is nested inside an "order" key
    if (raw.order && !raw.orderItems) {
      raw = raw.order;
    }

    const customerMappings = mappings.filter(m => m.fieldGroup === 'Customer');
    const orderMappings = mappings.filter(m => m.fieldGroup === 'Order');
    const productMappings = mappings.filter(m => m.fieldGroup === 'Product');

    // ─── 1. Evaluate Customer Payload ───
    const customerPayload: any = {
      disabled: 0,
      doctype: 'Customer',
      naming_series: 'CUST-.YYYY.-'
    };
    for (const m of customerMappings) {
      const mField = order.source === MarketplaceSource.AMAZON ? m.amazonField : m.flipkartField;
      if (mField) {
        customerPayload[m.erpnextField] = evaluateTemplate(mField, raw);
      }
    }

    // Apply mandatory defaults if they were not mapped or are empty
    if (!customerPayload.customer_name) {
      customerPayload.customer_name = order.customerName || `Customer-${order.marketplaceOrderId}`;
    }
    if (!customerPayload.customer_type) {
      customerPayload.customer_type = 'Individual';
    }
    if (!customerPayload.customer_group) {
      customerPayload.customer_group = 'Individual';
    }
    if (!customerPayload.territory) {
      customerPayload.territory = 'India';
    }

    // Ensure customer exists
    const customerResult = await this.connector.getOrCreateCustomer(customerPayload);
    if (!customerResult.success) {
      throw new Error(`Failed to sync customer: ${customerResult.error}`);
    }
    const customerName = customerResult.data?.name || customerPayload.customer_name || `Customer-${order.marketplaceOrderId}`;

    // ─── 2. Evaluate Address Payload ───
    const addr = raw.recipient?.deliveryAddress || raw.ShippingAddress || {};
    
    // Support both camelCase (V2) and PascalCase (SP-API)
    const addrName = addr.name || addr.Name || '';
    const addressLine1 = addr.addressLine1 || addr.AddressLine1 || '';
    const addressLine2 = addr.addressLine2 || addr.AddressLine2 || '';
    const city = addr.city || addr.City || '';
    
    let state = addr.stateOrRegion || addr.StateOrRegion || '';
    if (state) {
      try {
        const stateJsonPath = path.resolve(process.cwd(), 'state.json');
        const supportedStates = require(stateJsonPath);
        const matchedState = supportedStates.find((s: string) => s.toLowerCase() === state.toLowerCase());
        if (matchedState) {
          state = matchedState;
        }
      } catch (e) {
        console.warn('Could not load or parse state.json', e);
      }
    }
    
    const postalCode = addr.postalCode || addr.PostalCode || '';
    const countryCode = (addr.countryCode || addr.CountryCode || '').toUpperCase();
    const phone = addr.phone || addr.Phone || '';

    // ERPNext expects full country names
    const countryMap: Record<string, string> = {
      'IN': 'India',
      'GB': 'United Kingdom',
      'UK': 'United Kingdom',
      'US': 'United States',
      'AE': 'United Arab Emirates',
      'SA': 'Saudi Arabia',
      'AU': 'Australia',
      'CA': 'Canada',
      'SG': 'Singapore',
    };
    const countryName = countryMap[countryCode] || countryCode || 'India';

    // Extract first and last name if possible
    const nameParts = addrName.split(' ');
    const firstName = nameParts[0] || `Amazon-${order.marketplaceOrderId}`;
    const lastName = nameParts.slice(1).join(' ') || '';

    const addressPayload = {
      doctype: 'Address',
      address_title: addrName || `Amazon-${order.marketplaceOrderId}`,
      address_line1: addressLine1 || `Amazon-${order.marketplaceOrderId}`,
      address_line2: addressLine2 || '',
      city: city || `Amazon-${order.marketplaceOrderId}`,
      first_name: firstName,
      last_name: lastName,
      state: state,
      country: countryName,
      pincode: postalCode,
      phone: phone,
      is_billing: 1,
      is_shipping: 1,
      links: [
        {
          link_doctype: 'Customer',
          link_name: customerName
        }
      ]
    };

    // We don't strictly fail the order if address creation fails (might already exist)
    const addressResult = await this.connector.createAddress(addressPayload);
    const addressName = addressResult.success ? addressResult.data?.name : undefined;

    // ─── 3. Evaluate Sales Order Payload ───
    const soPayload: any = {
      company,
      naming_series: 'AMZ-ORD-.{custom_marketplace_order_id}.-',
      custom_marketplace_order_id: order.marketplaceOrderId,
      order_type: 'Sales',
      doctype: 'Sales Order',
      currency: 'INR',
      selling_price_list: 'Standard Selling',
      customer: customerName,
      customer_name: customerName,
    };

    if (addressName) {
      soPayload.customer_address = addressName;
      soPayload.shipping_address_name = addressName;
      soPayload.customer_primary_address = addressName;
    }

    for (const m of orderMappings) {
      const mField = order.source === MarketplaceSource.AMAZON ? m.amazonField : m.flipkartField;
      if (mField) {
        soPayload[m.erpnextField] = evaluateTemplate(mField, raw);
      }
    }

    // ─── 4. Evaluate Items Payload ───
    soPayload.items = [];
    const itemsRaw = raw.orderItems || raw.items || [{}]; // fallback to 1 empty item if missing
    for (let i = 0; i < itemsRaw.length; i++) {
      const itemPayload: any = {
        parenttype: 'Sales Order',
        doctype: 'Sales Order Item'
      };
      for (const m of productMappings) {
        const mField = order.source === MarketplaceSource.AMAZON ? m.amazonField : m.flipkartField;
        if (mField) {
          itemPayload[m.erpnextField] = evaluateTemplate(mField, raw, i);
        }
      }
      soPayload.items.push(itemPayload);
    }

    // Submit Sales Order
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

  async createItem(fields: Record<string, any>): Promise<any> {
    const result = await this.connector.createItem(fields);
    if (!result.success) {
      throw new Error(`Failed to create ERPNext item: ${result.error}`);
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

  async attachFile(doctype: string, docname: string, fileUrl: string): Promise<any> {
    const result = await this.connector.attachFile(doctype, docname, fileUrl);
    if (!result.success) {
      throw new Error(`Failed to attach file to ${doctype} ${docname}: ${result.error}`);
    }
    return result.data;
  }

  async removeAttachedFile(doctype: string, docname: string, fileUrl: string): Promise<any> {
    const result = await this.connector.removeAttachedFile(doctype, docname, fileUrl);
    if (!result.success) {
      throw new Error(`Failed to remove attached file from ${doctype} ${docname}: ${result.error}`);
    }
    return result.data;
  }
}
