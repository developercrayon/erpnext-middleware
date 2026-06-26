import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PricingService } from './pricing.service';
import { PricingSyncQueryDto, TriggerPriceSyncDto } from './dto/pricing.dto';

@ApiTags('Pricing')
@Controller('pricing')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  @ApiOperation({ summary: 'List price sync records with filtering' })
  async findAll(@Query() query: PricingSyncQueryDto) {
    return this.pricingService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get pricing sync statistics' })
  async getStats() {
    return this.pricingService.getStats();
  }

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue async background sync for prices' })
  async syncPrices(@Body() dto: TriggerPriceSyncDto) {
    const jobId = await this.pricingService.triggerSync(dto.source, dto.skus, dto.priceList);
    return { message: 'Price sync job queued', jobId };
  }

  @Post('sync/direct')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger a direct synchronous push to marketplace (blocking)' })
  async directSyncPrices(@Body() dto: TriggerPriceSyncDto) {
    const result = await this.pricingService.pushToMarketplace(dto.source, dto.skus, dto.priceList);
    return { message: 'Prices pushed successfully', ...result };
  }
}
