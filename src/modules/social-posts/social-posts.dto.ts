import { IsString, IsOptional, IsEnum, IsArray } from 'class-validator';
import { PostType, SocialPostStatus } from '../../database/entities/social-post.entity';

export class CreateSocialPostDto {
  @IsString()
  productItemCode: string;

  @IsString()
  campaignId: string;

  @IsString()
  platform: string;

  @IsEnum(PostType)
  postType: PostType;

  @IsString()
  @IsOptional()
  marketingGoal?: string;

  @IsString()
  @IsOptional()
  aspectRatio?: string;

  @IsOptional()
  customPrompts?: Record<string, string>;
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
