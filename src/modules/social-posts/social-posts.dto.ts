import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { PostType, SocialPostStatus } from '../../database/entities/social-post.entity';

export class CreateSocialPostDto {
  @IsString()
  productItemCode: string;

  @IsString()
  @IsOptional()
  campaignId?: string;

  @IsString()
  platform: string;

  @IsString()
  postType: string;

  @IsString()
  @IsOptional()
  marketingGoal?: string;

  @IsString()
  @IsOptional()
  aspectRatio?: string;

  @IsOptional()
  customPrompts?: Record<string, string>;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  selectedImagePromptImages?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  selectedReelPromptImages?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  selectedContentPromptImages?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  selectedImagePromptBase64s?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  selectedReelPromptBase64s?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  selectedContentPromptBase64s?: string[];
}

export class UpdateSocialPostDto {
  @IsString()
  @IsOptional()
  generatedPost?: string;

  @IsString()
  @IsOptional()
  caption?: string;

  @IsString()
  @IsOptional()
  hashtags?: string;

  @IsString()
  @IsOptional()
  hook?: string;

  @IsString()
  @IsOptional()
  cta?: string;

  @IsString()
  @IsOptional()
  videoReelScript?: string;

  @IsEnum(SocialPostStatus)
  @IsOptional()
  status?: SocialPostStatus;
}

export class ScheduleSocialPostDto {
  @IsString()
  scheduledAt: string; // ISO string
}
