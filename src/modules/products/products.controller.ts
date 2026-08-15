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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ProductsService, ProductStatus } from './products.service';
import { ProductQueryDto, SyncProductsDto, UpdateProductDto } from './dto/product.dto';

@ApiTags('Products')
@Controller('products')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

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

  @Put(':id')
  @ApiOperation({ summary: 'Update product details' })
  async updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto
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
