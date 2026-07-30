import { IsOptional, IsString } from 'class-validator';

export class CreateCountryDto {
  @IsString()
  @IsOptional()
  erpnext?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  amazon?: string;

  @IsString()
  @IsOptional()
  flipkart?: string;
}

export class UpdateCountryDto extends CreateCountryDto {}
