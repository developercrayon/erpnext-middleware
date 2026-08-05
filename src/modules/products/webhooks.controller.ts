import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductsService } from './products.service';
import { WebhookLog } from '../../database/entities/logs.entity';

@ApiTags('Webhooks')
@Controller('webhooks')
export class ProductsWebhookController {
  private readonly logger = new Logger(ProductsWebhookController.name);

  constructor(
    private readonly productsService: ProductsService,
    @InjectRepository(WebhookLog)
    private readonly webhookLogRepo: Repository<WebhookLog>,
  ) {}

  @Post('erpnext/product')
  @ApiOperation({ summary: 'ERPNext Webhook for Product Create/Update' })
  async handleERPNextProductWebhook(
    @Headers('authorization') authHeader: string,
    @Body() payload: any
  ) {
    const secret = process.env.ERPNEXT_WEBHOOK_SECRET;
    
    // Check if the secret is configured and matches the Authorization header or x-erpnext-signature
    if (secret && authHeader !== secret) {
      this.logger.warn('Unauthorized webhook attempt');
      throw new UnauthorizedException('Invalid webhook secret');
    }

    // ERPNext might send the doc directly, or wrap it in 'data', 'message', or 'doc'
    let doc = payload;
    if (payload.data && typeof payload.data === 'object') doc = payload.data;
    else if (payload.message && typeof payload.message === 'object') doc = payload.message;
    else if (payload.doc && typeof payload.doc === 'object') doc = payload.doc;

    const itemCode = doc.item_code || doc.name;
    
    const logEntry = this.webhookLogRepo.create({
      source: 'ERPNEXT',
      eventType: 'Product Update',
      headers: { authorization: authHeader ? '***' : undefined }, // Redact secret
      rawPayload: payload,
      signatureValid: true,
      processed: !!itemCode,
      processingError: itemCode ? null : 'Missing item_code',
    });
    
    if (!itemCode) {
      await this.webhookLogRepo.save(logEntry);
      this.logger.warn(`Received webhook without item_code. Payload: ${JSON.stringify(payload).substring(0, 500)}`);
      return { success: false, message: 'Missing item_code', receivedKeys: Object.keys(payload) };
    }

    this.logger.log(`Received ERPNext webhook for item: ${itemCode}`);
    
    // Trigger targeted fetch
    const jobId = await this.productsService.triggerFetchFromERPNext(itemCode);
    
    logEntry.queueJobId = jobId;
    await this.webhookLogRepo.save(logEntry);
    
    return { success: true, message: 'Sync job queued', jobId };
  }

  @Post('erpnext/fetch-from-amazon')
  @ApiOperation({ summary: 'ERPNext Webhook to fetch single product from Amazon' })
  async handleERPNextFetchFromAmazonWebhook(
    @Headers('authorization') authHeader: string,
    @Body() payload: any
  ) {
    const secret = process.env.ERPNEXT_WEBHOOK_SECRET;
    
    if (secret && authHeader !== secret) {
      this.logger.warn('Unauthorized webhook attempt');
      throw new UnauthorizedException('Invalid webhook secret');
    }

    let doc = payload;
    if (payload.data && typeof payload.data === 'object') doc = payload.data;
    else if (payload.message && typeof payload.message === 'object') doc = payload.message;
    else if (payload.doc && typeof payload.doc === 'object') doc = payload.doc;

    const sku = doc.sku || doc.item_code || doc.name;
    
    if (!sku) {
      this.logger.warn(`Received webhook without SKU. Payload: ${JSON.stringify(payload).substring(0, 500)}`);
      return { success: false, message: 'Missing sku or item_code' };
    }

    this.logger.log(`Received ERPNext webhook to fetch from Amazon for SKU: ${sku}`);
    
    try {
      const result = await this.productsService.fetchSingleFromAmazonAndStore(sku);
      return { success: true, message: `Product ${sku} fetched from Amazon successfully`, data: result };
    } catch (err: any) {
      this.logger.error(`Failed to fetch product ${sku} from Amazon via webhook: ${err.message}`);
      return { success: false, message: err.message || `Failed to fetch product ${sku} from Amazon` };
    }
  }
}
