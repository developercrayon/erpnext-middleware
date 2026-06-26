import { Logger } from '@nestjs/common';
import {
  ConnectorResult,
  NormalizedInventory,
  NormalizedOrder,
  NormalizedPrice,
  NormalizedProduct,
  NormalizedShipment,
  PaginatedResult,
} from './connector.types';
import {
  FetchOrdersParams,
  FetchProductsParams,
  IConnector,
  UpdateResult,
} from './connector.interface';

/**
 * BaseConnector provides common utilities (logging, error wrapping, retry logic)
 * for all marketplace and ERP connectors. Each concrete connector must extend
 * this class and implement the abstract methods.
 */
export abstract class BaseConnector implements IConnector {
  protected readonly logger: Logger;
  protected accessToken: string | null = null;
  protected tokenExpiresAt: Date | null = null;

  constructor(protected readonly connectorName: string) {
    this.logger = new Logger(connectorName);
  }

  // ─── Abstract Methods (must be implemented by each connector) ────────────

  abstract authenticate(): Promise<ConnectorResult<boolean>>;
  abstract healthCheck(): Promise<ConnectorResult<{ status: string; latencyMs: number }>>;
  abstract fetchOrders(params?: FetchOrdersParams): Promise<ConnectorResult<PaginatedResult<NormalizedOrder>>>;
  abstract fetchProducts(params?: FetchProductsParams): Promise<ConnectorResult<PaginatedResult<NormalizedProduct>>>;
  abstract updateInventory(items: NormalizedInventory[]): Promise<ConnectorResult<UpdateResult>>;
  abstract updatePrice(items: NormalizedPrice[]): Promise<ConnectorResult<UpdateResult>>;
  abstract createShipment(shipment: NormalizedShipment): Promise<ConnectorResult<{ shipmentId: string }>>;
  abstract cancelOrder(orderId: string, reason?: string): Promise<ConnectorResult<boolean>>;

  // ─── Common Utilities ─────────────────────────────────────────────────────

  /**
   * Wraps a response in a successful ConnectorResult
   */
  protected success<T>(data: T, meta?: Record<string, any>): ConnectorResult<T> {
    return { success: true, data, meta };
  }

  /**
   * Wraps an error in a failed ConnectorResult
   */
  protected failure(error: string | Error, statusCode?: number): ConnectorResult<never> {
    const message = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;
    this.logger.error(`Connector error: ${message}`, stack);
    return { success: false, error: message, statusCode };
  }

  /**
   * Checks if the current token is still valid (with a 5-minute buffer)
   */
  protected isTokenValid(): boolean {
    if (!this.accessToken || !this.tokenExpiresAt) return false;
    const buffer = 5 * 60 * 1000; // 5 minutes
    return this.tokenExpiresAt.getTime() - Date.now() > buffer;
  }

  /**
   * Ensures a valid token is available, re-authenticating if necessary
   */
  protected async ensureAuthenticated(): Promise<void> {
    if (!this.isTokenValid()) {
      this.logger.log('Token expired or missing, re-authenticating...');
      const result = await this.authenticate();
      if (!result.success) {
        throw new Error(`Authentication failed for ${this.connectorName}: ${result.error}`);
      }
    }
  }

  /**
   * Retries an operation with exponential backoff
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    baseDelayMs = 1000,
  ): Promise<T> {
    let lastError: Error;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Attempt ${attempt}/${maxRetries} failed. Retrying in ${delay}ms... Error: ${lastError.message}`,
          );
          await this.sleep(delay);
        }
      }
    }
    throw lastError;
  }

  /**
   * Promise-based sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Measures execution time of an async operation
   */
  protected async measureTime<T>(
    operation: () => Promise<T>,
  ): Promise<{ result: T; durationMs: number }> {
    const start = Date.now();
    const result = await operation();
    return { result, durationMs: Date.now() - start };
  }

  /**
   * Chunks an array into batches of a given size
   */
  protected chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
