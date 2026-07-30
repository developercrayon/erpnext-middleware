import { IsString, IsOptional } from 'class-validator';

export class CreateUnitDto {
  @IsString()
  @IsOptional()
  erpnext?: string;

  @IsString()
  @IsOptional()
  amazon?: string;

  @IsString()
  @IsOptional()
  flipkart?: string;
}

export class UpdateUnitDto extends CreateUnitDto {}
