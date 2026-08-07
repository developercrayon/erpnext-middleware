import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AmazonVariantMappingService } from './amazon-variant-mapping.service';

@ApiTags('Amazon Variant Mapping')
@Controller('amazon-variant-mapping')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AmazonVariantMappingController {
  constructor(private readonly service: AmazonVariantMappingService) {}

  @Get()
  @ApiOperation({ summary: 'List variant mappings' })
  async findAll(@Query('page') page: number = 1, @Query('limit') limit: number = 50) {
    return this.service.findAll(page, limit);
  }

  @Post()
  @ApiOperation({ summary: 'Create new variant mapping' })
  async create(@Body() createDto: any) {
    return this.service.create(createDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a variant mapping' })
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
