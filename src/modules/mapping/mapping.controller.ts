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

  @Get('fields/amazon/unique')
  @ApiOperation({ summary: 'Get unique Amazon fields' })
  async getUniqueAmazonFields() {
    return this.mappingService.getUniqueAmazonFields();
  }

  @Get('fields/amazon')
  @ApiOperation({ summary: 'Get available Amazon fields' })
  async getAmazonFields(@Query('productType') productType?: string) {
    return this.mappingService.getAmazonFields(productType);
  }

  @Get('fields/erpnext')
  @ApiOperation({ summary: 'Get available ERPNext fields' })
  async getErpnextFields(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.mappingService.getErpnextFields(
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
      search,
    );
  }

  @Post('fields/erpnext/sync')
  @ApiOperation({ summary: 'Sync available ERPNext fields from ERPNext' })
  async syncErpnextFields() {
    return this.mappingService.syncErpnextFields();
  }

  @Get('fields/erpnext/:doctype/schema')
  @ApiOperation({ summary: 'Get schema for a specific ERPNext DocType' })
  async getErpnextDocTypeSchema(@Param('doctype') doctype: string) {
    return this.mappingService.getErpnextDocTypeSchema(doctype);
  }

  @Put('fields/erpnext/:id')
  @ApiOperation({ summary: 'Update an ERPNext field (e.g. templates)' })
  async updateErpnextField(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { amazonTemplate?: string; flipkartTemplate?: string }
  ) {
    return this.mappingService.updateErpnextField(id, dto);
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Create multiple field mappings' })
  async createBulk(@Body() dto: BulkCreateMappingDto) {
    return this.mappingService.createBulk(dto.mappings, dto.marketplace, dto.productType);
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
