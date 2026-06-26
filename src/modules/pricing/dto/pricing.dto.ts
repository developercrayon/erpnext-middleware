import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MarketplaceSource } from '../../../database/entities/order.entity';

export class PricingSyncQueryDto {
  @ApiPropertyOptional({ enum: MarketplaceSource })
  @IsOptional()
  @IsEnum(MarketplaceSource)
  source?: MarketplaceSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number = 20;
}

export class TriggerPriceSyncDto {
  @ApiPropertyOptional({
    enum: MarketplaceSource,
    description: 'Target marketplace to push prices to (null = all)',
  })
  @IsOptional()
  @IsEnum(MarketplaceSource)
  source?: MarketplaceSource;

  @ApiPropertyOptional({ description: 'Specific SKUs to sync prices for', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skus?: string[];

  @ApiPropertyOptional({ description: 'ERPNext price list to fetch from' })
  @IsOptional()
  @IsString()
  priceList?: string;
}
