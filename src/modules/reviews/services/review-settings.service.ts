import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface ReviewSettingsDto {
  aiDraftsCount: number;
  autoPublishMinRating: number;
  autoPublishEnabled: boolean;
  autoApprove5Star: boolean;
  googleReviewMinRating: number;
  brandTone: string;
  maxPhotosPerReview: number;
  voiceInputEnabled: boolean;
  googleReviewUrl?: string;
  quickSuggestionsCount?: number;
}

@Injectable()
export class ReviewSettingsService {
  private readonly logger = new Logger(ReviewSettingsService.name);
  private readonly settingsFilePath = path.resolve(process.cwd(), 'data', 'review-settings.json');
  private settings: ReviewSettingsDto = {
    aiDraftsCount: 4,
    autoPublishMinRating: 3.5,
    autoPublishEnabled: true,
    autoApprove5Star: false,
    googleReviewMinRating: 4,
    brandTone: 'Artisanal & Warm',
    maxPhotosPerReview: 5,
    voiceInputEnabled: true,
    googleReviewUrl: 'https://g.page/r/woodwolff-artisan/review',
    quickSuggestionsCount: 5,
  };

  constructor() {
    this.loadSettings();
  }

  private loadSettings() {
    try {
      const dir = path.dirname(this.settingsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.settingsFilePath)) {
        const raw = fs.readFileSync(this.settingsFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.settings = { ...this.settings, ...parsed };
        this.logger.log(`Loaded review settings: AI drafts count = ${this.settings.aiDraftsCount}`);
      } else {
        this.saveSettings(this.settings);
      }
    } catch (e) {
      this.logger.warn(`Failed to load review-settings.json: ${e.message}`);
    }
  }

  getSettings(): ReviewSettingsDto {
    return { ...this.settings };
  }

  saveSettings(newSettings: Partial<ReviewSettingsDto>): ReviewSettingsDto {
    this.settings = {
      ...this.settings,
      ...newSettings,
      aiDraftsCount: Math.min(10, Math.max(1, Number(newSettings.aiDraftsCount ?? this.settings.aiDraftsCount))),
      autoPublishMinRating: Math.min(5, Math.max(1, Number(newSettings.autoPublishMinRating ?? this.settings.autoPublishMinRating ?? 3.5))),
      autoPublishEnabled: newSettings.autoPublishEnabled !== undefined ? Boolean(newSettings.autoPublishEnabled) : this.settings.autoPublishEnabled,
      googleReviewMinRating: Number(newSettings.googleReviewMinRating ?? this.settings.googleReviewMinRating),
      maxPhotosPerReview: Number(newSettings.maxPhotosPerReview ?? this.settings.maxPhotosPerReview),
    };

    try {
      const dir = path.dirname(this.settingsFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.settingsFilePath, JSON.stringify(this.settings, null, 2), 'utf8');
      this.logger.log(`Updated review settings: AI drafts = ${this.settings.aiDraftsCount}`);
    } catch (e) {
      this.logger.error(`Failed to write review-settings.json: ${e.message}`);
    }
    return this.settings;
  }
}
