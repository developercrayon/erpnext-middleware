import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { SeoService } from './services/seo.service';
import {
  UpdateIssueStatusDto,
  CreateSeoTaskDto,
  UpdateSeoTaskDto,
  ToggleSignoffDto,
} from './dto/seo.dto';

@ApiTags('SEO Mission Control & Catalog Audit')
@Controller(['seo', 'api/seo', 'api/admin/seo'])
export class SeoController {
  constructor(private readonly seoService: SeoService) {}

  @Get(['dashboard', 'data'])
  @ApiOperation({ summary: 'Get SEO dashboard summary, issues, GSC matrix, GA4 metrics and tasks' })
  @ApiResponse({ status: 200, description: 'Dashboard metrics and issues retrieved successfully' })
  async getDashboardData() {
    return await this.seoService.getDashboardData();
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run real-time catalog SEO defect sweep against ERPNext' })
  @ApiResponse({ status: 200, description: 'Sweep completed and issues refreshed' })
  async syncCatalogSweep() {
    const result = await this.seoService.syncCatalogSweep();
    return {
      success: true,
      message: `Sweep completed. Scanned ${result.totalScanned} items, detected ${result.issuesFound} defects (${result.newIssues} new, ${result.autoResolved} auto-resolved).`,
      data: result.dashboard,
      meta: {
        totalScanned: result.totalScanned,
        issuesFound: result.issuesFound,
        newIssues: result.newIssues,
        autoResolved: result.autoResolved,
      },
    };
  }

  @Patch('issues/:id/snooze')
  @ApiOperation({ summary: 'Snooze a defect for 7, 14, or 30 days' })
  @ApiResponse({ status: 200, description: 'Issue snoozed successfully' })
  async snoozeIssue(
    @Param('id') id: string,
    @Body() body: { days?: number; reason?: string },
  ) {
    const issue = await this.seoService.snoozeIssue(id, body?.days || 7, body?.reason || 'Snoozed');
    return {
      success: true,
      message: `Issue snoozed until ${issue.snoozed_until}`,
      data: issue,
    };
  }

  @Patch('issues/:id/resolve')
  @ApiOperation({ summary: 'Mark a defect as RESOLVED' })
  @ApiResponse({ status: 200, description: 'Issue marked as resolved' })
  async resolveIssue(
    @Param('id') id: string,
    @Body() body: { resolvedBy?: string },
  ) {
    const issue = await this.seoService.resolveIssue(id, body?.resolvedBy || 'SEO Auditor');
    return {
      success: true,
      message: 'Issue marked as resolved',
      data: issue,
    };
  }

  @Patch('issues/:id')
  @ApiOperation({ summary: 'Update defect status (Resolve or Snooze)' })
  @ApiResponse({ status: 200, description: 'Issue status updated' })
  async updateIssueStatus(
    @Param('id') id: string,
    @Body() dto: UpdateIssueStatusDto,
  ) {
    const issue = await this.seoService.updateIssueStatus(id, dto);
    return {
      success: true,
      message: `Issue status updated to ${issue.status}`,
      data: issue,
    };
  }

  @Get(['export/csv', 'csv'])
  @ApiOperation({ summary: 'Download RFC-4180 compliant CSV audit report' })
  @ApiResponse({ status: 200, description: 'CSV file stream' })
  async exportCsv(@Res() res: Response) {
    const csvContent = await this.seoService.exportCsvReport();
    const filename = `woodwolf-seo-catalog-audit-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(HttpStatus.OK).send(csvContent);
  }

  @Post(['signoff', 'monday-signoff'])
  @ApiOperation({ summary: 'Weekly Monday sign-off audit log recording auditor name and timestamp' })
  @ApiResponse({ status: 200, description: 'Sign-off recorded' })
  async recordSignoff(
    @Body() body: { auditorName?: string; weekIdentifier?: string; notes?: string; itemText?: string; isCompleted?: boolean; signedOffBy?: string },
  ) {
    if (body.itemText) {
      const signoff = await this.seoService.toggleSignoff({
        weekIdentifier: body.weekIdentifier || '',
        itemText: body.itemText,
        isCompleted: body.isCompleted !== undefined ? body.isCompleted : true,
        signedOffBy: body.signedOffBy || body.auditorName || 'Operations Lead',
      });
      return {
        success: true,
        data: signoff,
      };
    }

    const result = await this.seoService.recordSignoff(body.auditorName, body.weekIdentifier, body.notes);
    return {
      success: true,
      message: 'Monday SEO audit checklist successfully signed off.',
      data: result,
    };
  }

  @Post('tasks')
  @ApiOperation({ summary: 'Create a Kanban task' })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  async createTask(@Body() dto: CreateSeoTaskDto) {
    const task = await this.seoService.createTask(dto);
    return {
      success: true,
      message: 'Task created successfully',
      data: task,
    };
  }

  @Patch('tasks/:id')
  @ApiOperation({ summary: 'Update a Kanban task' })
  @ApiResponse({ status: 200, description: 'Task updated successfully' })
  async updateTask(
    @Param('id') id: string,
    @Body() dto: UpdateSeoTaskDto,
  ) {
    const task = await this.seoService.updateTask(id, dto);
    return {
      success: true,
      message: 'Task updated successfully',
      data: task,
    };
  }

  @Delete('tasks/:id')
  @ApiOperation({ summary: 'Delete a Kanban task' })
  @ApiResponse({ status: 200, description: 'Task deleted successfully' })
  async deleteTask(@Param('id') id: string) {
    const deleted = await this.seoService.deleteTask(id);
    return {
      success: deleted,
      message: deleted ? 'Task deleted' : 'Task not found',
    };
  }
}

