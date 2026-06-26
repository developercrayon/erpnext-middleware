import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ERPNextConnector } from '../../modules/connectors/erpnext/erpnext.connector';
import { AmazonConnector } from '../../modules/connectors/amazon/amazon.connector';
import { FlipkartConnector } from '../../modules/connectors/flipkart/flipkart.connector';
import Redis from 'ioredis';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly erpnext: ERPNextConnector,
    private readonly amazon: AmazonConnector,
    private readonly flipkart: FlipkartConnector,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Basic application health check' })
  async health(): Promise<Record<string, any>> {
    const dbOk = this.dataSource.isInitialized;
    
    // Quick redis check
    let redisOk = false;
    let redis: Redis | null = null;
    try {
      const redisUrl = this.config.get<string>('redis.url');
      if (redisUrl) {
        redis = new Redis(redisUrl, { lazyConnect: true, connectTimeout: 2000 });
      } else {
        redis = new Redis({
          host: this.config.get<string>('redis.host'),
          port: this.config.get<number>('redis.port'),
          password: this.config.get<string>('redis.password'),
          lazyConnect: true,
          connectTimeout: 2000,
        });
      }
      await redis.connect();
      redisOk = redis.status === 'ready' || redis.status === 'connect';
    } catch (e) {
      redisOk = false;
    } finally {
      if (redis) redis.disconnect();
    }

    return {
      status: dbOk && redisOk ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'connected' : 'disconnected',
        redis: redisOk ? 'connected' : 'disconnected',
        app: 'running',
      },
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Get('detailed')
  @ApiOperation({ summary: 'Detailed health check including external connectors' })
  async detailedHealth(): Promise<Record<string, any>> {
    const basic = await this.health();

    const [erpnextHealth, amazonHealth, flipkartHealth] = await Promise.all([
      this.erpnext.healthCheck().catch((e) => ({ success: false, error: e.message })),
      this.amazon.healthCheck().catch((e) => ({ success: false, error: e.message })),
      this.flipkart.healthCheck().catch((e) => ({ success: false, error: e.message })),
    ]);

    return {
      ...basic,
      connectors: {
        erpnext: erpnextHealth.success ? 'healthy' : 'unhealthy',
        amazon: amazonHealth.success ? 'healthy' : 'unhealthy',
        flipkart: flipkartHealth.success ? 'healthy' : 'unhealthy',
      },
    };
  }
}
