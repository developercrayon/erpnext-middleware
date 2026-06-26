import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MarketplaceSource } from '../../../database/entities/order.entity';

export class InventoryQueryDto {
  @ApiPropertyOptional({ enum: MarketplaceSource })
  @IsOptional()
  @IsEnum(MarketplaceSource)
  source?: MarketplaceSource;

  @ApiPropertyOptional({ description: 'Filter by SKU' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: 'Filter by warehouse' })
  @IsOptional()
  @IsString()
  warehouse?: string;

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

export class TriggerInventorySyncDto {
  @ApiPropertyOptional({
    enum: MarketplaceSource,
    description: 'Target marketplace to sync to (null = all)',
  })
  @IsOptional()
  @IsEnum(MarketplaceSource)
  source?: MarketplaceSource;

  @ApiPropertyOptional({ description: 'Specific SKUs to sync (empty = all)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skus?: string[];

  @ApiPropertyOptional({ description: 'Specific warehouse to sync from' })
  @IsOptional()
  @IsString()
  warehouse?: string;
}
