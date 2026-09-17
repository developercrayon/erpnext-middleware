import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ManualInvoiceItemDto {
  @IsString()
  @IsNotEmpty()
  item_code: string;

  @IsString()
  @IsOptional()
  item_name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0.01)
  quantity: number;

  @IsString()
  @IsOptional()
  uom?: string;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsNumber()
  @IsOptional()
  discount_percentage?: number;

  @IsNumber()
  @IsOptional()
  discount_amount?: number;

  @IsNumber()
  @IsOptional()
  tax_percentage?: number;

  @IsString()
  @IsOptional()
  warehouse?: string;
}

export class CreateManualInvoiceDto {
  @IsString()
  @IsNotEmpty()
  supplier: string;

  @IsString()
  @IsNotEmpty()
  invoice_number: string;

  @IsString()
  @IsNotEmpty()
  posting_date: string;

  @IsString()
  @IsOptional()
  due_date?: string;

  @IsString()
  @IsOptional()
  po_number?: string;

  @IsString()
  @IsOptional()
  company?: string;

  @IsString()
  @IsOptional()
  warehouse?: string;

  @IsString()
  @IsOptional()
  cost_center?: string;

  @IsString()
  @IsOptional()
  payment_terms?: string;

  @IsString()
  @IsOptional()
  remarks?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ManualInvoiceItemDto)
  items: ManualInvoiceItemDto[];

  @IsOptional()
  submit_to_erp?: boolean;
}
