import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { ConfigService } from '@nestjs/config';

/**
 * HttpClientService wraps Axios with built-in:
 * - Structured request/response logging
 * - Configurable timeouts
 * - Error normalization
 */
@Injectable()
export class HttpClientService {
  private readonly logger = new Logger(HttpClientService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.client = axios.create({
      timeout: 30000,
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
        return response;
      },
      (error) => {
        const status = error.response?.status;
        const url = error.config?.url;
        const message = error.response?.data?.message || error.message;
        this.logger.error(`← ${status || 'ERR'} ${url} — ${message}`);
        return Promise.reject(this.normalizeError(error));
      },
    );
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
