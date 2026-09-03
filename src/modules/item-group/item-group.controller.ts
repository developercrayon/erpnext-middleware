import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ItemGroupService } from './item-group.service';

@Controller('v1/item-groups')
export class ItemGroupController {
  constructor(private readonly itemGroupService: ItemGroupService) {}

  @Get('erpnext')
  async fetchFromERPNext(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    const limit_page_length = pageSize ? parseInt(pageSize, 10) : 50;
    const p = page ? parseInt(page, 10) : 1;
    const limit_start = (p - 1) * limit_page_length;

    return await this.itemGroupService.fetchFromERPNext({
      limit_start,
      limit_page_length,
      search,
    });
  }

  @Get('config/:itemGroup')
  async getConfig(@Param('itemGroup') itemGroup: string) {
    return await this.itemGroupService.getConfig(itemGroup);
  }

  @Post('config/:itemGroup')
  async saveConfig(
    @Param('itemGroup') itemGroup: string,
    @Body() body: { amazonProductType?: string, imagePrompts?: any[] },
  ) {
    return await this.itemGroupService.saveConfig(itemGroup, body);
  }
}
