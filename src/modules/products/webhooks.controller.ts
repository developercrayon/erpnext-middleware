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
    
    const queuedJobs = [];

    // Trigger Amazon syncs if enabled
    if (doc.disabled == 1 || doc.disabled === true || !doc.custom_amazon || doc.custom_amazon == 0) {
      this.logger.log(`Disabling Amazon listing (qty=0, price=0) for ${itemCode}`);
      
      this.productsService.disableAmazonListing(itemCode).catch(e => {
        this.logger.error(`Failed to zero-out Amazon listing for ${itemCode}: ${e.message}`);
      });
      queuedJobs.push({ type: 'Amazon Zero Out Sync', status: 'triggered' });
    } else if (doc.custom_amazon) {
      this.logger.log(`Queueing Amazon syncs for ${itemCode}`);
      
      const syncJobId = await this.productsService.triggerSync(MarketplaceSource.AMAZON, [itemCode], true);
      queuedJobs.push({ type: 'Amazon Full Sync', jobId: syncJobId });
      
      const priceJobId = await this.pricingService.triggerSync(MarketplaceSource.AMAZON, [itemCode]);
      queuedJobs.push({ type: 'Amazon Price Sync', jobId: priceJobId });
      
      // Removed direct inventory sync from product webhook
      // const inventoryJobId = await this.inventoryService.triggerSync(MarketplaceSource.AMAZON, [itemCode]);
      // queuedJobs.push({ type: 'Amazon Inventory Sync', jobId: inventoryJobId });
    }



    // Trigger Flipkart syncs if enabled
    if (doc.custom_flipkart) {
      this.logger.log(`Skipping Flipkart syncs for ${itemCode} (Temporarily bypassed)`);
      // const fkSyncJobId = await this.productsService.triggerSync(MarketplaceSource.FLIPKART, [itemCode]);
      // queuedJobs.push({ type: 'Flipkart Sync', jobId: fkSyncJobId });
    }
    
    logEntry.processed = true;
    await this.webhookLogRepo.save(logEntry);
    
    return { success: true, message: 'Processed locally', queuedJobs };
  }

}
