import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { SalesInvoiceService } from './services/sales-invoice.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { ConvertOrderToInvoiceDto } from './dto/convert-order-to-invoice.dto';
import { UpdateSalesInvoiceDto } from './dto/update-sales-invoice.dto';

@Controller('sales-invoices')
export class SalesInvoiceController {
  constructor(private readonly salesInvoiceService: SalesInvoiceService) {}

  @Post()
  async createInvoice(@Body() dto: CreateSalesInvoiceDto, @Query('user') user?: string) {
    return this.salesInvoiceService.createSalesInvoice(dto, user || 'User');
  }

  @Post('convert-order')
  async convertOrderToInvoice(@Body() dto: ConvertOrderToInvoiceDto, @Query('user') user?: string) {
    return this.salesInvoiceService.convertSalesOrderToInvoice(dto, user || 'User');
  }

  @Get()
  async getAllInvoices(@Query('status') status?: string, @Query('search') search?: string) {
    return this.salesInvoiceService.getAllInvoices(status, search);
  }

  @Get('stats')
  async getStats() {
    return this.salesInvoiceService.getDashboardStats();
  }

  @Get(':id')
  async getInvoiceById(@Param('id') id: string) {
    return this.salesInvoiceService.getInvoiceById(id);
  }

  @Patch(':id')
  async updateInvoice(
    @Param('id') id: string,
    @Body() dto: UpdateSalesInvoiceDto,
    @Query('user') user?: string,
  ) {
    return this.salesInvoiceService.updateInvoiceData(id, dto, user || 'User');
  }

  @Post(':id/approve')
  async approveAndPushToErpNext(@Param('id') id: string, @Query('user') user?: string) {
    return this.salesInvoiceService.approveAndPushToErpNext(id, user || 'User');
  }

  @Delete(':id')
  async deleteInvoice(@Param('id') id: string) {
    return this.salesInvoiceService.deleteInvoice(id);
  }
}
