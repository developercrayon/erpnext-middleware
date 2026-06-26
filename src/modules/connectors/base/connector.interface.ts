import {
  ConnectorResult,
  NormalizedInventory,
  NormalizedOrder,
  NormalizedPrice,
  NormalizedProduct,
  NormalizedShipment,
  PaginatedResult,
} from './connector.types';

/**
 * IConnector defines the contract that every marketplace/ERP connector must fulfill.
 * All methods return a ConnectorResult wrapper for uniform error handling.
 */
export interface IConnector {
  /** Authenticate with the external service and store/refresh tokens */
  authenticate(): Promise<ConnectorResult<boolean>>;

  /** Verify the connector can reach the external service */
  healthCheck(): Promise<ConnectorResult<{ status: string; latencyMs: number }>>;

  /** Fetch orders from the external service with optional filters */
  fetchOrders(params?: FetchOrdersParams): Promise<ConnectorResult<PaginatedResult<NormalizedOrder>>>;

  /** Fetch products/catalog from the external service */
  fetchProducts(params?: FetchProductsParams): Promise<ConnectorResult<PaginatedResult<NormalizedProduct>>>;

  /** Update inventory levels on the external service */
  updateInventory(items: NormalizedInventory[]): Promise<ConnectorResult<UpdateResult>>;

  /** Update product prices on the external service */
  updatePrice(items: NormalizedPrice[]): Promise<ConnectorResult<UpdateResult>>;

  /** Create a shipment / confirm dispatch on the external service */
  createShipment(shipment: NormalizedShipment): Promise<ConnectorResult<{ shipmentId: string }>>;

  /** Cancel an order on the external service */
  cancelOrder(orderId: string, reason?: string): Promise<ConnectorResult<boolean>>;
}

export interface FetchOrdersParams {
  fromDate?: Date;
  toDate?: Date;
  status?: string;
  nextToken?: string;
  pageSize?: number;
}

export interface FetchProductsParams {
  nextToken?: string;
  pageSize?: number;
  category?: string;
}

export interface UpdateResult {
  total: number;
  success: number;
  failed: number;
  errors?: Array<{ sku: string; error: string }>;
}
