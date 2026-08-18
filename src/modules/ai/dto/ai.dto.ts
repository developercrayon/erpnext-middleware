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
}
