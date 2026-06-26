import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Request } from 'express';
import { generateCorrelationId } from '../../utils/crypto.util';

/**
 * ResponseInterceptor wraps all successful responses in a standard envelope.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const correlationId =
      (request.headers['x-correlation-id'] as string) || generateCorrelationId();

    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        correlationId,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}

/**
 * LoggingInterceptor logs incoming requests and their response times.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = request;
    const start = Date.now();

    this.logger.log(`→ ${method} ${url} [${ip}]`);

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        const response = context.switchToHttp().getResponse();
        this.logger.log(`← ${method} ${url} ${response.statusCode} (${duration}ms)`);
      }),
    );
  }
}
