import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MarketplaceSource } from '../../../database/entities/order.entity';

export class CreateShipmentDto {
  @ApiProperty({ description: 'Internal order UUID' })
  @IsUUID()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ description: 'Shipment tracking number' })
  @IsString()
  @IsNotEmpty()
  trackingNumber: string;

  @ApiProperty({ description: 'Carrier name', example: 'Delhivery' })
  @IsString()
  @IsNotEmpty()
  carrier: string;

  @ApiPropertyOptional({ description: 'Carrier service type', example: 'Express' })
  @IsOptional()
  @IsString()
  carrierService?: string;

  @ApiPropertyOptional({ description: 'Estimated delivery date (ISO string)' })
  @IsOptional()
  @IsString()
  estimatedDelivery?: string;
}

export class ShipmentQueryDto {
  @ApiPropertyOptional({ enum: MarketplaceSource })
  @IsOptional()
  @IsEnum(MarketplaceSource)
  source?: MarketplaceSource;

  @ApiPropertyOptional({ description: 'Filter by sync status', example: 'SYNCED' })
  @IsOptional()
  @IsString()
  syncStatus?: string;

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
