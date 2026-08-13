import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { OrderFieldMappingService } from './order-field-mapping.service';
import { OrderFieldMapping } from '../../database/entities/order-field-mapping.entity';
import { MarketplaceSource } from '../../database/entities/order.entity';

@ApiTags('Order Field Mapping')
@Controller('order-field-mappings')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class OrderFieldMappingController {
  constructor(private readonly service: OrderFieldMappingService) {}

  @Get()
  @ApiOperation({ summary: 'List all order field mappings' })
  async findAll(@Query('marketplace') marketplace?: MarketplaceSource) {
    return this.service.findAll(marketplace);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk save order field mappings for a marketplace' })
  async bulkSave(
    @Body() body: { mappings: Partial<OrderFieldMapping>[]; marketplace: MarketplaceSource }
  ) {
    return this.service.bulkSave(body.mappings, body.marketplace);
  }
}
