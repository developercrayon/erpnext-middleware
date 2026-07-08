import { IsString, IsBoolean, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MarketplaceSource } from '../../../database/entities/order.entity';

export class CreateMappingDto {
  @ApiProperty({ enum: MarketplaceSource })
  @IsEnum(MarketplaceSource)
  marketplace: MarketplaceSource;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  productType?: string;

  @ApiProperty()
  @IsString()
  erpnextField: string;

  @ApiProperty()
  @IsString()
  marketplaceField: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  dataType?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  useDefault?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  defaultValue?: string;
}

import { ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class BulkCreateMappingDto {
  @ApiProperty({ type: [CreateMappingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateMappingDto)
  mappings: CreateMappingDto[];
}

export class UpdateMappingDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  productType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  erpnextField?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  marketplaceField?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  dataType?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  useDefault?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  defaultValue?: string;
}
