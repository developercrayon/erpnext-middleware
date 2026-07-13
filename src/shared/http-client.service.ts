import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { ConfigService } from '@nestjs/config';
import { ApiLog } from '../database/entities/logs.entity';

/**
 * HttpClientService wraps Axios with built-in:
 * - Structured request/response logging
 * - Configurable timeouts
 * - Error normalization
 * - Saves logs to ApiLog table
 */
@Injectable()
export class HttpClientService {
  private readonly logger = new Logger(HttpClientService.name);
  private readonly client: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ApiLog)
    private readonly apiLogRepo: Repository<ApiLog>,
  ) {
    this.client = axios.create({
      timeout: 100000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      (config) => {
        const start = Date.now();
        (config as any).metadata = { startTime: start };
        this.logger.debug(
          `→ ${config.method?.toUpperCase()} ${config.url}`,
          { params: config.params },
        );
        return config;
      },
      (error) => {
        this.logger.error('Request setup error', error.message);
        return Promise.reject(error);
      },
    );

    this.client.interceptors.response.use(
      (response) => {
        const duration = Date.now() - ((response.config as any).metadata?.startTime || Date.now());
        this.logger.debug(
          `← ${response.status} ${response.config.url} (${duration}ms)`,
        );
        this.saveLog(response.config, response, duration, null).catch(err => this.logger.error('Failed to save API Log', err));
        return response;
      },
      (error) => {
        const duration = Date.now() - ((error.config as any)?.metadata?.startTime || Date.now());
        const status = error.response?.status;
        const url = error.config?.url;
        const responseData = error.response?.data;
        const message = responseData?.errors?.[0]?.message || responseData?.message || error.message;
        // Log full response body for debugging (especially Amazon 403s)
        this.logger.error(`← ${status || 'ERR'} ${url} — ${message}`, responseData ? JSON.stringify(responseData) : '');
        this.saveLog(error.config, error.response, duration, error).catch(err => this.logger.error('Failed to save API Log', err));
        return Promise.reject(this.normalizeError(error));
      },
    );
  }

  private async saveLog(config: any, response: any, duration: number, error: any) {
    if (!config) return;
    
    // Determine the service name based on URL
    let service = 'UNKNOWN';
    const urlStr = config.url || '';
    if (urlStr.includes('amazon')) service = 'AMAZON';
    else if (urlStr.includes('flipkart')) service = 'FLIPKART';
    else if (urlStr.includes('erpnext') || urlStr.includes(this.config.get('erpnext.baseUrl') || '')) service = 'ERPNEXT';

    // Safely parse request body - JSON.parse is synchronous, not a Promise
    let requestBody = config.data;
    if (typeof config.data === 'string') {
      try { requestBody = JSON.parse(config.data); } catch { requestBody = config.data; }
    }

    const logEntry = this.apiLogRepo.create({
      service,
      method: (config.method || 'GET').toUpperCase(),
      url: urlStr,
      requestHeaders: config.headers,
      requestBody,
      responseStatus: response?.status || null,
      responseBody: response?.data || null,
      durationMs: duration,
      error: error ? (error.message || String(error)) : null,
    });
    
    await this.apiLogRepo.save(logEntry);
  }

  private normalizeError(error: any): Error {
    if (error.response) {
      const { status, data } = error.response;
      const message = data?.message || data?.error || `HTTP ${status}`;
      const err = new Error(message);
      (err as any).status = status;
      (err as any).data = data;
      return err;
    }
    if (error.request) {
      return new Error(`No response received: ${error.message}`);
    }
    return error;
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.put<T>(url, data, config);
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.patch<T>(url, data, config);
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }
}
