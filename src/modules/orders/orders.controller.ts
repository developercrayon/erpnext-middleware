import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Headers,
  RawBodyRequest,
  Req,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { OrdersService } from './orders.service';
import { OrderQueryDto, WebhookOrderDto, SyncOrderDto } from './dto/order.dto';
import { ApiKeyGuard } from '../../common/guards/api-key.guard';
import { MarketplaceSource } from '../../database/entities/order.entity';
import { verifyHmacSignature } from '../../utils/crypto.util';
import { ConfigService } from '@nestjs/config';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly config: ConfigService,
  ) {}

  // ─── Webhook Endpoints (API Key protected) ────────────────────────────────

  @Post('webhooks/amazon')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Receive Amazon SP-API order webhook' })
  @ApiHeader({ name: 'x-api-key', required: true })
  @ApiHeader({ name: 'x-amzn-notification-type', required: false })
  async amazonWebhook(
    @Body() rawPayload: Record<string, any>,
    @Headers('x-amzn-notification-type') eventType: string,
    @Headers('x-amzn-signature') signature: string,
  ) {
    const webhookSecret = this.config.get<string>('security.webhookSecret');
    const signatureValid = signature
      ? verifyHmacSignature(JSON.stringify(rawPayload), signature, webhookSecret)
      : false;

    return this.ordersService.ingestWebhook(
      MarketplaceSource.AMAZON,
      rawPayload,
      eventType || 'ORDER_STATUS_CHANGE',
      signatureValid,
    );
  }

  @Post('webhooks/flipkart')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Receive Flipkart order webhook' })
  @ApiHeader({ name: 'x-api-key', required: true })
  async flipkartWebhook(
    @Body() rawPayload: Record<string, any>,
    @Headers('x-flipkart-signature') signature: string,
  ) {
    const webhookSecret = this.config.get<string>('security.webhookSecret');
    const signatureValid = signature
      ? verifyHmacSignature(JSON.stringify(rawPayload), signature, webhookSecret)
      : false;

    return this.ordersService.ingestWebhook(
      MarketplaceSource.FLIPKART,
      rawPayload,
      'ORDER_APPROVED',
      signatureValid,
    );
  }

  // ─── Internal API Endpoints (JWT protected) ───────────────────────────────

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all orders with filtering and pagination' })
  async findAll(@Query() query: OrderQueryDto) {
    return this.ordersService.findAll(query);
  }

  @Get('stats')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get order sync statistics' })
  async getStats() {
    return this.ordersService.getStats();
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get order by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findById(id);
  }

  @Post(':id/sync')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Manually trigger order sync to ERPNext' })
  async syncOrder(@Param('id', ParseUUIDPipe) id: string) {
    const jobId = await this.ordersService.requeueOrder(id);
    return { message: 'Order queued for sync', jobId };
  }

  @Get('failed/list')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all failed orders pending retry' })
  async getFailedOrders() {
    return this.ordersService.getFailedOrders();
  }
}
