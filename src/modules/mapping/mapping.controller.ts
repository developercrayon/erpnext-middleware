import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { MappingService } from './mapping.service';
import { CreateMappingDto, UpdateMappingDto, BulkCreateMappingDto } from './dto/mapping.dto';
import { MarketplaceSource } from '../../database/entities/order.entity';

@ApiTags('Field Mapping')
@Controller('mappings')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class MappingController {
  constructor(private readonly mappingService: MappingService) {}

  @Get()
  @ApiOperation({ summary: 'List all field mappings' })
  async findAll(
    @Query('marketplace') marketplace?: MarketplaceSource,
    @Query('productType') productType?: string
  ) {
    return this.mappingService.findAll(marketplace, productType);
  }

  @Get('fields/amazon')
  @ApiOperation({ summary: 'Get available Amazon fields' })
  async getAmazonFields(@Query('productType') productType?: string) {
    return this.mappingService.getAmazonFields(productType);
  }

  @Get('fields/erpnext')
  @ApiOperation({ summary: 'Get available ERPNext fields' })
  async getErpnextFields() {
    return this.mappingService.getErpnextFields();
  }

  @Post('fields/erpnext/sync')
  @ApiOperation({ summary: 'Sync available ERPNext fields from ERPNext' })
  async syncErpnextFields() {
    return this.mappingService.syncErpnextFields();
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Create multiple field mappings' })
  async createBulk(@Body() dto: BulkCreateMappingDto) {
    return this.mappingService.createBulk(dto.mappings);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new field mapping' })
  async create(@Body() dto: CreateMappingDto) {
    return this.mappingService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing field mapping' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMappingDto) {
    return this.mappingService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a field mapping' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.mappingService.delete(id);
    return { success: true };
  }
}
