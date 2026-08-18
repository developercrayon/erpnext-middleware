import { Controller, Get, Post, Body, UseGuards, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AiSettingsService } from '../services/ai-settings.service';
import { AiModelService } from '../services/ai-model.service';
import { AiConfigType } from '../../../database/entities/ai.entity';
import { UpsertAiSettingsDto } from '../dto/ai.dto';

@Controller('ai')
@UseGuards(AuthGuard('jwt'))
export class AiSettingsController {
  constructor(
    private readonly settingsService: AiSettingsService,
    private readonly modelService: AiModelService,
  ) {}

  @Get('models')
  getModels(@Query('capability') capability?: 'content' | 'image' | 'structured' | 'flat') {
    if (capability === 'content') {
      return this.modelService.getContentModels();
    }
    if (capability === 'image') {
      return this.modelService.getImageModels();
    }
    if (capability === 'flat') {
      return this.modelService.getAllModels();
    }
    return this.modelService.getStructuredModels();
  }

  @Get('settings')
  async getSettings() {
    const content = await this.settingsService.getSafeSettings(AiConfigType.CONTENT);
    const image = await this.settingsService.getSafeSettings(AiConfigType.IMAGE);

    return {
      content,
      image,
    };
  }

  @Post('settings')
  async upsertSettings(@Body() dto: UpsertAiSettingsDto) {
    if (dto.content) {
      await this.settingsService.upsertContentSettings(dto.content);
    }
    if (dto.image) {
      await this.settingsService.upsertImageSettings(dto.image);
    }

    return { message: 'AI settings updated successfully' };
  }
}
