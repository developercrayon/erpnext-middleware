import {
  IsNotEmpty,
  IsString,
  IsNumber,
  Min,
  Max,
  IsOptional,
  IsBoolean,
  IsArray,
} from 'class-validator';

export class SubmitReviewDto {
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
  title?: string;

  @IsNotEmpty()
  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  originalContent?: string;

  @IsOptional()
  @IsBoolean()
  aiGenerated?: boolean;

  @IsOptional()
  @IsBoolean()
  aiEditedByCustomer?: boolean;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsArray()
  mediaIds?: string[];

  @IsOptional()
  @IsString()
  overallFeedback?: string;
}
