import { MarketplaceSource } from '../../../database/entities/order.entity';

// ─── Normalized Data Types ────────────────────────────────────────────────────

export interface NormalizedAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  phone?: string;
}

export interface NormalizedOrderItem {
  sku: string;
  marketplaceSku?: string;
  marketplaceItemId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  tax?: number;
  total: number;
  taxRate?: number;
  hsnCode?: string;
  itemStatus?: string;
  fulfillmentCenter?: string;
  rawPayload?: Record<string, any>;
}

export interface NormalizedOrder {
  marketplaceOrderId: string;
  source: MarketplaceSource;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress: NormalizedAddress;
  billingAddress?: NormalizedAddress;
  items: NormalizedOrderItem[];
  subtotal: number;
  discount?: number;
  tax?: number;
  shippingCharge?: number;
  total: number;
  currency: string;
  paymentMethod?: string;
  paymentStatus?: string;
  orderDate: Date;
  promisedDeliveryDate?: Date;
  rawPayload?: Record<string, any>;
}

export interface NormalizedProduct {
  sku: string;
  marketplaceSku?: string;
  name: string;
  description?: string;
  category?: string;
  brand?: string;
  mrp: number;
  sellingPrice: number;
  hsnCode?: string;
  gstRate?: number;
  weight?: number;
  images?: string[];
  attributes?: Record<string, any>;
  rawPayload?: Record<string, any>;
}

export interface NormalizedInventory {
  sku: string;
  warehouse: string;
  availableQty: number;
  reservedQty?: number;
  marketplaceQty?: number;
  rawPayload?: Record<string, any>;
}

export interface NormalizedPrice {
  sku: string;
  sellingPrice: number;
  mrp?: number;
  priceList?: string;
  currency?: string;
}

export interface NormalizedShipment {
  orderId: string;
  marketplaceOrderId: string;
  trackingNumber: string;
  carrier: string;
  carrierService?: string;
  shippedAt?: Date;
  estimatedDelivery?: Date;
  rawPayload?: Record<string, any>;
}

// ─── Connector Result ────────────────────────────────────────────────────────

export interface ConnectorResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
  meta?: Record<string, any>;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextToken?: string;
}
