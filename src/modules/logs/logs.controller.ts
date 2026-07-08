import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Delete,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { LogsService } from './logs.service';
import { LogQueryDto, ErrorLogQueryDto, SyncHistoryQueryDto } from './dto/log.dto';

@ApiTags('Logs')
@Controller('logs')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get overall logging and error statistics' })
  async getStats() {
    return this.logsService.getStats();
  }

  @Get('connectors')
  @ApiOperation({ summary: 'Query connector API logs' })
  async getConnectorLogs(@Query() query: LogQueryDto) {
    return this.logsService.getConnectorLogs(query);
  }

  @Get('webhooks')
  @ApiOperation({ summary: 'Query incoming webhook logs' })
  async getWebhookLogs(@Query() query: LogQueryDto) {
    return this.logsService.getWebhookLogs(query);
  }

  @Get('api')
  @ApiOperation({ summary: 'Query internal API access logs' })
  async getApiLogs(@Query() query: LogQueryDto) {
    return this.logsService.getApiLogs(query);
  }

  @Get('errors')
  @ApiOperation({ summary: 'Query application and integration error logs' })
  async getErrorLogs(@Query() query: ErrorLogQueryDto) {
    return this.logsService.getErrorLogs(query);
  }

  @Get('errors/:id')
  @ApiOperation({ summary: 'Get a single error log by ID' })
  async getErrorLogById(@Param('id', ParseUUIDPipe) id: string) {
    return this.logsService.getErrorLogById(id);
  }

  @Delete('errors')
  @ApiOperation({ summary: 'Delete multiple error logs' })
  async deleteErrorLogs(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids)) {
      return { success: false, message: 'Invalid ids array' };
    }
    await this.logsService.deleteErrorLogs(body.ids);
    return { success: true, message: `Deleted ${body.ids.length} error logs` };
  }

  @Get('history')
  @ApiOperation({ summary: 'Query overall sync operation history' })
  async getSyncHistory(@Query() query: SyncHistoryQueryDto) {
    return this.logsService.getSyncHistory(query);
  }

  @Post('errors/:id/resolve')
  @ApiOperation({ summary: 'Mark an error log as resolved' })
  async resolveError(@Param('id', ParseUUIDPipe) id: string) {
    const error = await this.logsService.resolveError(id);
    return { message: 'Error resolved', error };
  }
}
