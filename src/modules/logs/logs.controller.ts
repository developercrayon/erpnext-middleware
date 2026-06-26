import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
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
