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

    // ERPNext sends the document in the body. If it's wrapped, it might be in payload.data or just the payload itself.
    // The Item code is typically in payload.name or payload.item_code.
    const itemCode = payload.item_code || payload.name;
    
    if (!itemCode) {
      this.logger.warn('Received webhook without item_code or name');
      return { success: false, message: 'Missing item_code' };
    }

    this.logger.log(`Received ERPNext webhook for item: ${itemCode}`);
    
    // Trigger targeted fetch
    const jobId = await this.productsService.triggerFetchFromERPNext(itemCode);
    
    return { success: true, message: 'Sync job queued', jobId };
  }
}
