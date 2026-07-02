import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ProductsService } from './products.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class ProductsWebhookController {
  private readonly logger = new Logger(ProductsWebhookController.name);

  constructor(private readonly productsService: ProductsService) {}

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
    
    if (!itemCode) {
      this.logger.warn(`Received webhook without item_code. Payload: ${JSON.stringify(payload).substring(0, 500)}`);
      return { success: false, message: 'Missing item_code', receivedKeys: Object.keys(payload) };
    }

    this.logger.log(`Received ERPNext webhook for item: ${itemCode}`);
    
    // Trigger targeted fetch
    const jobId = await this.productsService.triggerFetchFromERPNext(itemCode);
    
    return { success: true, message: 'Sync job queued', jobId };
  }
}
