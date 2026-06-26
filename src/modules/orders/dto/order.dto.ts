import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
  IsObject,
  IsDateString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MarketplaceSource, OrderStatus, SyncStatus } from '../../../database/entities/order.entity';

export class WebhookOrderDto {
  @ApiProperty({ description: 'Raw payload from the marketplace webhook' })
  @IsObject()
  payload: Record<string, any>;

  @ApiProperty({ enum: MarketplaceSource })
  @IsEnum(MarketplaceSource)
  source: MarketplaceSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  signature?: string;
}

export class OrderQueryDto {
  @ApiPropertyOptional({ enum: MarketplaceSource })
  @IsOptional()
  @IsEnum(MarketplaceSource)
  source?: MarketplaceSource;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ enum: SyncStatus })
  @IsOptional()
  @IsEnum(SyncStatus)
  syncStatus?: SyncStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  toDate?: string;

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

export class SyncOrderDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  orderId: string;
}
