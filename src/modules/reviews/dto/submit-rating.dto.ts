import { IsNotEmpty, IsString, IsNumber, Min, Max, IsOptional } from 'class-validator';

export class SubmitRatingDto {
  @IsNotEmpty()
  @IsString()
  orderItemId: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.5)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  source?: string;
}
