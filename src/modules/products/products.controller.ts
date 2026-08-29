import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ProductsService, ProductStatus } from './products.service';
import { ProductQueryDto, SyncProductsDto, UpdateProductDto } from './dto/product.dto';
import { AmazonConnector } from '../connectors/amazon/amazon.connector';

@ApiTags('Products')
@Controller('products')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly amazonConnector: AmazonConnector
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all products with filtering and pagination' })
  async findAll(@Query() query: ProductQueryDto) {
    return this.productsService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get product statistics' })
  async getStats() {
    return this.productsService.getStats();
  }

  @Get('options/reference')
  @ApiOperation({ summary: 'Get reference data for product editing (Brands, Categories, etc)' })
  async getReferenceData() {
    return this.productsService.getReferenceData();
  }

  @Get('options/schema')
  @ApiOperation({ summary: 'Get the ERPNext Item doctype schema' })
  async getItemSchema() {
    return this.productsService.getItemSchema();
  }

  @Get('options/schema/:doctype')
  @ApiOperation({ summary: 'Get the ERPNext doctype schema for a given doctype' })
  async getDoctypeSchema(@Param('doctype') doctype: string) {
    return this.productsService.getDoctypeSchema(doctype);
  }

  @Get('options/link/:doctype')
  @ApiOperation({ summary: 'Get options for an ERPNext Link field' })
  async getLinkOptions(@Param('doctype') doctype: string, @Query('q') query?: string) {
    return this.productsService.getLinkOptions(doctype, query);
  }

  @Get(':id/erpnext-data')
  @ApiOperation({ summary: 'Get full product data from ERPNext' })
  async getFullItem(@Param('id') id: string) {
    return this.productsService.getFullItem(id);
  }

  @Post('resolve-display-values')
  @ApiOperation({ summary: 'Resolve ERPNext hashes to human-readable titles' })
  async resolveDisplayValues(@Body() data: any) {
    return this.productsService.resolveItemDisplayValues(data);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'Get attachments from ERPNext' })
  async getAttachments(@Param('id') id: string) {
    return this.productsService.getItemAttachments(id);
  }

  @Delete('attachments/:fileName')
  @ApiOperation({ summary: 'Delete an attachment from ERPNext' })
  async deleteAttachment(@Param('fileName') fileName: string) {
    return this.productsService.deleteAttachment(fileName);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by SKU/ID' })
  async findOne(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Post('create-sync')
  @ApiOperation({ summary: 'Create a new product directly in ERPNext' })
  async createProduct(@Body() dto: any) {
    try {
      const product = await this.productsService.createProduct(dto);
      return { success: true, message: 'Product created successfully', data: product };
    } catch (error: any) {
      throw new BadRequestException(
        error.message || 'Failed to create product'
      );
    }
  }

  @Post('upload-image')
  @ApiOperation({ summary: 'Upload an image file to ERPNext' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file provided');
    try {
      const result = await this.productsService.uploadImage(file);
      return result;
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to upload image');
    }
  }

  @Post('upload-image-to-item')
  @ApiOperation({ summary: 'Upload an image file and attach it to a specific ERPNext Item' })
  @UseInterceptors(FileInterceptor('file'))
  async uploadImageToItem(
    @UploadedFile() file: any,
    @Body('item_code') itemCode: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!itemCode) throw new BadRequestException('item_code is required');
    try {
      const result = await this.productsService.uploadImageToItem(file, itemCode);
      return result;
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to upload image to item');
    }
  }

  @Post('create-variants-bulk')
  @ApiOperation({
    summary:
      'Enqueue bulk ERPNext item variant creation from a template (calls enqueue_multiple_variant_creation)',
  })
  async createVariantsBulk(
    @Body()
    dto: {
      item: string;
      args: Record<string, string[]> | string;
      use_template_image?: number;
    },
  ) {
    try {
      if (!dto.item) throw new Error('item is required');

      // Accept args as a plain object OR as a pre-serialised JSON string
      const argsMap: Record<string, string[]> =
        typeof dto.args === 'string' ? JSON.parse(dto.args) : dto.args;

      const result = await this.productsService.createMultipleVariants(
        dto.item,
        argsMap,
        dto.use_template_image ?? 0,
      );
      return {
        success: true,
        message: 'Variant creation enqueued in ERPNext',
        data: result,
      };
    } catch (error: any) {
      throw new BadRequestException(
        error.message || 'Failed to enqueue variant creation',
      );
    }
  }


  @Put(':id')
  @ApiOperation({ summary: 'Update product details' })
  async updateProduct(
    @Param('id') id: string,
    @Body() dto: any
  ) {
    try {
      const product = await this.productsService.updateProduct(id, dto);
      return { success: true, message: 'Product updated successfully', data: product };
    } catch (error: any) {
      throw new BadRequestException(
        error.message || 'Failed to update product'
      );
    }
  }

  @Post(':id/sync-amazon')
  @ApiOperation({ summary: 'Queue single product sync to Amazon' })
  async syncToAmazon(@Param('id') id: string) {
    try {
      // In this new architecture, ID is the SKU.
      const jobId = await this.productsService.triggerSync(undefined, [id], true);
      return { success: true, message: `Product queued for sync (Job ID: ${jobId})` };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to trigger Amazon sync');
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a product' })
  async remove(@Param('id') id: string) {
    try {
      await this.productsService.remove(id);
      return { success: true, message: 'Product deleted from ERPNext successfully' };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to delete product');
    }
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Toggle product active/inactive status' })
  async updateStatus(
    @Param('id') id: string,
    @Body('disabled') disabled: number
  ) {
    try {
      await this.productsService.updateStatus(id, disabled);
      return { success: true, message: `Product marked as ${disabled === 1 ? 'disabled' : 'enabled'}` };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to update status');
    }
  }

  @Post('sync/amazon-validate-single')
  @ApiOperation({ summary: 'Validate single product on Amazon SP-API' })
  async validateAmazonListing(@Body('sku') sku: string) {
    try {
      const spData = await this.amazonConnector.getListingItem(sku);

      if (spData.is404) {
        return {
          success: true,
          data: {
            amazon_listed: false,
            has_404: true,
            active: false,
            in_stock: false,
            valid: true,
            has_issues: false
          }
        };
      }

      const active = spData.summaries?.some((s: any) => s.status?.includes("BUYABLE") || s.statuses?.includes("BUYABLE")) || false;
      const availableQuantity = spData.fulfillmentAvailability?.[0]?.quantity ?? 0;
      const in_stock = availableQuantity > 0;
      
      const issues = spData.issues || [];
      const has_issues = issues.length > 0;
      
      // valid is false ONLY if there is an ERROR
      const hasError = issues.some((i: any) => i.severity === 'ERROR');
      const valid = !hasError;

      return { 
        success: true, 
        message: 'Amazon validation successful', 
        data: { 
          amazon_listed: true,
          has_404: false,
          active,
          in_stock,
          valid,
          has_issues,
          raw_issues: issues
        } 
      };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to validate Amazon listing');
    }
  }

  @Post('sync')
  @ApiOperation({ summary: 'Trigger product sync to marketplaces' })
  async syncToMarketplaces(@Body() dto: SyncProductsDto) {
    try {
      const jobId = await this.productsService.triggerSync(dto.source, dto.skus);
      return { success: true, message: 'Sync job queued successfully', jobId };
    } catch (error: any) {
      throw new BadRequestException(error.message || 'Failed to trigger sync');
    }
  }
}
