import {
  Controller,
  Get,
  Post,
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
import { ProductQueryDto, SyncProductsDto } from './dto/product.dto';

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

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findById(id);
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
