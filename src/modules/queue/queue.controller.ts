import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { QueueService } from './queue.service';

@ApiTags('Queue')
@Controller('queue')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated queue jobs' })
  async getQueueJobs(@Query() query: any) {
    return this.queueService.getQueueJobs(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single queue job by ID' })
  async getQueueJobById(@Param('id', ParseUUIDPipe) id: string) {
    return this.queueService.getQueueJobById(id);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete multiple queue jobs' })
  async deleteQueueJobs(@Body() body: { ids: string[] }) {
    if (!body.ids || !Array.isArray(body.ids)) {
      return { success: false, message: 'Invalid ids array' };
    }
    await this.queueService.deleteQueueJobs(body.ids);
    return { success: true, message: `Deleted ${body.ids.length} queue jobs` };
  }
}
