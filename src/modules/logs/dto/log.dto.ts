import { IsEnum, IsOptional, IsString, IsBoolean, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum LogSourceFilter {
  ERPNEXT = 'ERPNEXT',
  AMAZON = 'AMAZON',
  FLIPKART = 'FLIPKART',
}

export class LogQueryDto {
  @ApiPropertyOptional({ enum: LogSourceFilter, description: 'Filter by source connector' })
  @IsOptional()
  @IsEnum(LogSourceFilter)
  source?: LogSourceFilter;

  @ApiPropertyOptional({ description: 'Filter by log level (INFO, WARN, ERROR, DEBUG)' })
  @IsOptional()
  @IsString()
  level?: string;

  @ApiPropertyOptional({ description: 'Filter from date (ISO string)' })
  @IsOptional()
  @IsString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Filter to date (ISO string)' })
  @IsOptional()
  @IsString()
  toDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number = 50;
}

export class ErrorLogQueryDto {
  @ApiPropertyOptional({ description: 'Filter by resolution status' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  resolved?: boolean;

  @ApiPropertyOptional({ description: 'Filter by source context' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number = 50;
}

export class SyncHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Filter by resource type (ORDER, INVENTORY, PRICE, SHIPMENT)' })
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiPropertyOptional({ description: 'Filter by source marketplace' })
  @IsOptional()
  @IsString()
  source?: string;

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
