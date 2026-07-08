import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import {
  ResponseInterceptor,
  LoggingInterceptor,
} from './common/interceptors/response.interceptor';
import * as pg from 'pg';

// Force pg driver to parse 'timestamp without time zone' columns as UTC
// instead of the local node process timezone. This fixes the -5:30 IST shift bug.
pg.types.setTypeParser(1114, str => new Date(str + 'Z'));

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // Workaround for AdminJS NestJS integration crash on Express 4/5
  const httpAdapter = app.getHttpAdapter();
  const originalGetInstance = httpAdapter.getInstance;
  httpAdapter.getInstance = function () {
    const instance = originalGetInstance.call(this);
    return new Proxy(instance, {
      get(target, prop, receiver) {
        if (prop === 'router') {
          return target._router;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };

  const config = app.get(ConfigService);

  // ─── Logger ───────────────────────────────────────────────────────────────
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // ─── Security ─────────────────────────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  const appUrl = config.get<string>('app.url') || '*';
  app.enableCors({
    origin: ['*'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-correlation-id'],
    credentials: true,
  });

  // ─── Compression ──────────────────────────────────────────────────────────
  app.use(compression());

  // ─── Global Prefix ────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1', {
    exclude: ['admin/(.*)', 'admin', '', '/'],
  });

  // ─── Validation ───────────────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ─── Global Filters ───────────────────────────────────────────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ─── Global Interceptors ──────────────────────────────────────────────────
  app.useGlobalInterceptors(new LoggingInterceptor(), new ResponseInterceptor());

  // ─── Swagger ──────────────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ERPNext Integration Middleware')
    .setDescription(
      `
      Production-ready middleware connecting ERPNext with Amazon and Flipkart marketplaces.
      
      ## Authentication
      - **Internal APIs**: Use JWT Bearer token (POST /api/v1/auth/login)
      - **Webhooks**: Use x-api-key header
      
      ## Queues Dashboard
      Available at /queues (Bull Board)
    `,
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Orders', 'Order management and webhook ingestion')
    .addTag('Inventory', 'Inventory synchronization')
    .addTag('Products', 'Product catalog management')
    .addTag('Pricing', 'Price synchronization')
    .addTag('Shipments', 'Shipment management')
    .addTag('Logs', 'System logs and monitoring')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'list',
      filter: true,
      tagsSorter: 'alpha',
    },
  });

  // ─── Start ────────────────────────────────────────────────────────────────
  const port = config.get<number>('app.port') || 3000;
  const env = config.get<string>('app.env') || 'development';

  await app.listen(port);

  console.log(`
  ╔════════════════════════════════════════════════════╗
  ║        ERPNext Integration Middleware              ║
  ╠════════════════════════════════════════════════════╣
  ║  Environment : ${env.padEnd(34)}║
  ║  Server      : ${(`http://localhost:${port}`).padEnd(34)}║
  ║  Swagger     : ${(`http://localhost:${port}/api/docs`).padEnd(34)}║
  ║  Admin Panel : ${(`http://localhost:${port}/admin`).padEnd(34)}║
  ╚════════════════════════════════════════════════════╝
  `);
}

bootstrap();
