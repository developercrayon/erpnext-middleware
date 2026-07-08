import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AmazonProductTypesService } from './amazon-product-types.service';

@ApiTags('Amazon Product Types')
@Controller('amazon-product-types')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AmazonProductTypesController {
  constructor(private readonly service: AmazonProductTypesService) {}

  @Get()
  @ApiOperation({ summary: 'List Amazon product types' })
  async getProductTypes(@Query('page') page: number = 1, @Query('limit') limit: number = 50, @Query('search') search?: string) {
    return this.service.getProductTypes(page, limit, search);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Trigger sync of Amazon product types' })
  async syncProductTypes() {
    return this.service.syncProductTypes();
  }

  @Get(':name/fields')
  @ApiOperation({ summary: 'List fields for a product type' })
  async getProductFields(@Param('name') name: string, @Query('page') page: number = 1, @Query('limit') limit: number = 50) {
    return this.service.getProductFields(name, page, limit);
  }

  @Post(':name/fields/sync')
  @ApiOperation({ summary: 'Trigger sync of fields for a product type' })
  async syncProductFields(@Param('name') name: string) {
    return this.service.syncProductFields(name);
  }
}
