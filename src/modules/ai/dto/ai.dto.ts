import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { AiProviderName } from '../constants/ai-models.registry';
import { AiConfigType } from '../../../database/entities/ai.entity';

export class ImagePromptDto {
  @IsString()
  @IsNotEmpty()
  promptText: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}

export class UpsertContentAiDto {
  @IsString()
  @IsNotEmpty()
  provider: AiProviderName;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsString()
  @IsOptional()
  apiKey?: string;

  @IsString()
  @IsOptional()
  apiSecret?: string;

  @IsString()
  @IsOptional()
  contentPrompt?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}

export class UpsertImageAiDto {
  @IsString()
  @IsNotEmpty()
  provider: AiProviderName;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsString()
  @IsOptional()
  apiKey?: string;

  @IsString()
  @IsOptional()
  apiSecret?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImagePromptDto)
  prompts?: ImagePromptDto[];

  @IsString()
  @IsOptional()
  masterPrompt?: string;
}

export class UpsertSocialMediaDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  platform: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;

  @IsString()
  @IsOptional()
  appName?: string;

  @IsString()
  @IsOptional()
  appId?: string;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  clientSecret?: string;

  @IsString()
  @IsOptional()
  authorizationUrl?: string;

  @IsString()
  @IsOptional()
  tokenUrl?: string;

  @IsString()
  @IsOptional()
  apiBaseUrl?: string;

  @IsString()
  @IsOptional()
  apiVersion?: string;

  @IsOptional()
  prompts?: {
    post?: string;
    caption?: string;
    hashtag?: string;
    hook?: string;
    cta?: string;
    videoReel?: string;
    contentIdea?: string;
  };
}


export class UpsertAiSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertContentAiDto)
  content?: UpsertContentAiDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertImageAiDto)
  image?: UpsertImageAiDto;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => UpsertSocialMediaDto)
  socialMedia?: UpsertSocialMediaDto[];
}

export class CreateAiProductDataDto {
  @IsString()
  @IsNotEmpty()
  item_name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  @IsUrl()
  reference_image_url?: string;

  @IsString()
  @IsOptional()
  reference_image_base64?: string;

  @IsString()
  @IsOptional()
  item_group?: string;
}

export class UpdateAiProductContentDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  meta_title?: string;

  @IsString()
  @IsOptional()
  meta_description?: string;

  @IsString()
  @IsOptional()
  short_description?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  bullet_points?: string[];
}
