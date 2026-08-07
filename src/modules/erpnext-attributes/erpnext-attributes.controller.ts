import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ErpnextAttributesService } from './erpnext-attributes.service';

@ApiTags('ERPNext Attributes')
@Controller('erpnext-attributes')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ErpnextAttributesController {
  constructor(private readonly service: ErpnextAttributesService) {}

  @Get()
  @ApiOperation({ summary: 'List ERPNext attributes' })
  async findAll(@Query('page') page: number = 1, @Query('limit') limit: number = 50, @Query('search') search?: string) {
    return this.service.findAll(page, limit, search);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Trigger sync of ERPNext attributes' })
  async syncAttributes() {
    return this.service.syncAttributes();
  }
}
