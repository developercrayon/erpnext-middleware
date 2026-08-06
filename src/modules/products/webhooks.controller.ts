import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductsService } from './products.service';
import { PricingService } from '../pricing/pricing.service';
import { InventoryService } from '../inventory/inventory.service';
import { WebhookLog } from '../../database/entities/logs.entity';
import { MarketplaceSource } from '../../database/entities/order.entity';

@ApiTags('Webhooks')
@Controller('webhooks')
export class ProductsWebhookController {
  private readonly logger = new Logger(ProductsWebhookController.name);

  constructor(
    private readonly productsService: ProductsService,
    private readonly pricingService: PricingService,
    private readonly inventoryService: InventoryService,
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
    
    // Process payload locally (no need to fetch from ERPNext)
    let processedData;
    try {
      processedData = await this.productsService.processWebhookPayload(doc, payload);
    } catch (err: any) {
      this.logger.error(`Failed to process webhook payload for ${itemCode}: ${err.message}`);
      logEntry.processingError = err.message;
      await this.webhookLogRepo.save(logEntry);
      return { success: false, message: 'Failed to process payload', error: err.message };
    }

    const queuedJobs = [];

    // Trigger Amazon syncs if enabled
    if (processedData.customAmazon) {
      this.logger.log(`Queueing Amazon syncs for ${itemCode}`);
      
      const syncJobId = await this.productsService.triggerSync(MarketplaceSource.AMAZON, [itemCode]);
      queuedJobs.push({ type: 'Amazon Full Sync', jobId: syncJobId });
      
      const priceJobId = await this.pricingService.triggerSync(MarketplaceSource.AMAZON, [itemCode]);
      queuedJobs.push({ type: 'Amazon Price Sync', jobId: priceJobId });
      
      const inventoryJobId = await this.inventoryService.triggerSync(MarketplaceSource.AMAZON, [itemCode]);
      queuedJobs.push({ type: 'Amazon Inventory Sync', jobId: inventoryJobId });
    }

    // Trigger Flipkart syncs if enabled
    if (processedData.customFlipkart) {
      this.logger.log(`Queueing Flipkart syncs for ${itemCode}`);
      const fkSyncJobId = await this.productsService.triggerSync(MarketplaceSource.FLIPKART, [itemCode]);
      queuedJobs.push({ type: 'Flipkart Sync', jobId: fkSyncJobId });
    }
    
    logEntry.processed = true;
    await this.webhookLogRepo.save(logEntry);
    
    return { success: true, message: 'Processed locally', queuedJobs };
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
