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
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ProductsService } from './products.service';
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
  async getFullItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.getFullItem(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update product details' })
  async updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto
  ) {
    const product = await this.productsService.updateProduct(id, dto);
    return { success: true, message: 'Product updated successfully', data: product };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete product by ID' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.productsService.delete(id);
    return { success: true, message: 'Product deleted successfully' };
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update product status (ACTIVE/INACTIVE)' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: any
  ) {
    const product = await this.productsService.updateStatus(id, status);
    return { success: true, message: 'Status updated successfully', data: product };
  }

  @Post('sync/erpnext')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger a full fetch of products from ERPNext' })
  async syncFromERPNext() {
    const jobId = await this.productsService.triggerFetchFromERPNext();
    return { message: 'ERPNext fetch job queued', jobId };
  }

  @Post('sync/marketplaces')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger product sync to marketplaces' })
  async syncToMarketplaces(@Body() dto: SyncProductsDto) {
    const jobId = await this.productsService.triggerSync(dto.source, dto.skus);
    return { message: 'Marketplace sync job queued', jobId };
  }
}
