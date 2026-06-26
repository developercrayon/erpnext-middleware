import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { InventoryService } from './inventory.service';
import { InventoryQueryDto, TriggerInventorySyncDto } from './dto/inventory.dto';

@ApiTags('Inventory')
@Controller('inventory')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'List inventory across all marketplaces' })
  async findAll(@Query() query: InventoryQueryDto) {
    return this.inventoryService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get inventory statistics' })
  async getStats() {
    return this.inventoryService.getStats();
  }

  @Get('history')
  @ApiOperation({ summary: 'Get recent inventory sync history' })
  async getSyncHistory() {
    return this.inventoryService.getSyncHistory();
  }

  @Get(':sku')
  @ApiOperation({ summary: 'Get inventory for a specific SKU' })
  async findBySku(@Param('sku') sku: string) {
    return this.inventoryService.findBySku(sku);
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue async background sync for inventory' })
  async syncInventory(@Body() dto: TriggerInventorySyncDto) {
    const jobId = await this.inventoryService.triggerSync(dto.source, dto.skus, dto.warehouse);
    return { message: 'Inventory sync job queued', jobId };
  }

  @Post('sync/direct')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger a direct synchronous push to marketplace (blocking)' })
  async directSyncInventory(@Body() dto: TriggerInventorySyncDto) {
    const result = await this.inventoryService.pushToMarketplace(dto.source, dto.skus, dto.warehouse);
    return { message: 'Inventory pushed successfully', ...result };
  }
}
