import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto, ShipmentQueryDto } from './dto/shipment.dto';

@ApiTags('Shipments')
@Controller('shipments')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List shipments with filtering and pagination' })
  async findAll(@Query() query: ShipmentQueryDto) {
    return this.shipmentsService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get shipment sync statistics' })
  async getStats() {
    return this.shipmentsService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get shipment by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.shipmentsService.findById(id);
  }

  @Get('order/:orderId')
  @ApiOperation({ summary: 'Get shipments for a specific order' })
  async findByOrderId(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.shipmentsService.findByOrderId(orderId);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue shipment creation and sync to ERPNext and Marketplace' })
  async createShipment(@Body() dto: CreateShipmentDto) {
    const jobId = await this.shipmentsService.createShipment(dto);
    return { message: 'Shipment creation job queued', jobId };
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync latest status for a shipment' })
  async syncStatus(@Param('id', ParseUUIDPipe) id: string) {
    await this.shipmentsService.syncShipmentStatus(id);
    return { message: 'Shipment status sync requested' };
  }
}
