import { IsNotEmpty, IsString, IsNumber, Min, Max, IsOptional, IsArray } from 'class-validator';

export class GenerateAiReviewDto {
  @IsNotEmpty()
  @IsString()
  orderItemId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.5)
  @Max(5)
  rating: number;

  @IsNotEmpty()
  @IsString()
  rawInput: string;

  @IsOptional()
  @IsString()
  spokenText?: string;

  @IsOptional()
  @IsNumber()
  uploadedPhotosCount?: number;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsString()
  productCategory?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  conversationHistory?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export class GenerateOverallAiReviewDto {
  @IsOptional()
  @IsString()
  rawInput?: string;

  @IsOptional()
  @IsString()
  spokenText?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsArray()
  productReviews?: Array<{
    productName: string;
    productCategory?: string;
    rating: number;
    reviewText?: string;
    spokenText?: string;
    uploadedPhotosCount?: number;
    hasPhotos?: boolean;
  }>;
}

