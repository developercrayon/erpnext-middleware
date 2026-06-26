import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * ApiKeyGuard validates the x-api-key header for webhook endpoints.
 * Use @UseGuards(ApiKeyGuard) on controllers that receive external webhook calls.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey =
      request.headers['x-api-key'] as string ||
      request.query['api_key'] as string;

    const validKey = this.config.get<string>('security.internalApiKey');

    if (!apiKey || apiKey !== validKey) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
