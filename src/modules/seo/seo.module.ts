import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeoIssue } from '../../database/entities/seo-issue.entity';
import { SeoTask } from '../../database/entities/seo-task.entity';
import { SeoSignoff } from '../../database/entities/seo-signoff.entity';
import { ErpItem } from '../../database/entities/erp-item.entity';
import { SeoScannerService } from './services/seo-scanner.service';
import { SeoAnalyticsService } from './services/seo-analytics.service';
import { SeoService } from './services/seo.service';
import { SeoController } from './seo.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SeoIssue, SeoTask, SeoSignoff, ErpItem]),
  ],
  controllers: [SeoController],
  providers: [SeoScannerService, SeoAnalyticsService, SeoService],
  exports: [SeoService, SeoScannerService],
})
export class SeoModule {}
