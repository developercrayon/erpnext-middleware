import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  Min,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '../../../database/entities/product.entity';
import { MarketplaceSource } from '../../../database/entities/order.entity';

export class ProductQueryDto {
  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ enum: MarketplaceSource, description: 'Filter by marketplace listing' })
  @IsOptional()
  @IsEnum(MarketplaceSource)
  marketplace?: MarketplaceSource;

  @ApiPropertyOptional({ description: 'Filter by SKU prefix' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiPropertyOptional({ description: 'Filter by category' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Filter by brand' })
  @IsOptional()
  @IsString()
  brand?: string;

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

export class SyncProductsDto {
  @ApiPropertyOptional({
    enum: MarketplaceSource,
    description: 'Target marketplace (null = all)',
  })
  @IsOptional()
  @IsEnum(MarketplaceSource)
  source?: MarketplaceSource;

  @ApiPropertyOptional({ description: 'Specific SKUs to sync (empty = all)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skus?: string[];
}

export class UpdateProductStatusDto {
  @ApiProperty({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  status: ProductStatus;
}
