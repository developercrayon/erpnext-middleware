import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { SalesOrderService } from './services/sales-order.service';
import { SalesOrderErpNextService } from './services/sales-order-erpnext.service';
import { SalesOrderAiService } from './services/sales-order-ai.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { ChatOrderPromptDto, VoiceOrderDto } from './dto/chat-order-prompt.dto';

const uploadStorage = diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.resolve(process.cwd(), 'uploads', 'sales-po');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

@Controller('sales-orders')
export class SalesOrderController {
  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly erpNextService: SalesOrderErpNextService,
    private readonly aiService: SalesOrderAiService,
  ) {}

  @Post()
  async createOrder(@Body() dto: CreateSalesOrderDto, @Query('user') user?: string) {
    return this.salesOrderService.createSalesOrder(dto, user || 'User');
  }

  @Get()
  async getAllOrders(@Query('status') status?: string, @Query('search') search?: string) {
    return this.salesOrderService.getAllOrders(status, search);
  }

  @Get('stats')
  async getStats() {
    return this.salesOrderService.getDashboardStats();
  }

  @Get('customers')
  async getCustomers(@Query('query') query?: string) {
    if (query) {
      return this.erpNextService.searchCustomersByNameOrGstin(query);
    }
    return this.erpNextService.getAllCustomers();
  }

  @Post('customers')
  async addCustomer(@Body() body: any) {
    return this.erpNextService.addCustomer(body);
  }

  @Get(':id')
  async getOrderById(@Param('id') id: string) {
    return this.salesOrderService.getOrderById(id);
  }

  @Patch(':id')
  async updateOrder(
    @Param('id') id: string,
    @Body() dto: UpdateSalesOrderDto,
    @Query('user') user?: string,
  ) {
    return this.salesOrderService.updateOrderData(id, dto, user || 'User');
  }

  @Post(':id/approve')
  async approveAndPushToErpNext(@Param('id') id: string, @Query('user') user?: string) {
    return this.salesOrderService.approveAndPushToErpNext(id, user || 'User');
  }

  @Delete(':id')
  async deleteOrder(@Param('id') id: string) {
    return this.salesOrderService.deleteOrder(id);
  }

  // --- AI MULTI-MODAL ENDPOINTS ---

  @Post('ai/chat')
  async processChatOrder(@Body() dto: ChatOrderPromptDto) {
    if (!dto.message || !dto.message.trim()) {
      throw new BadRequestException('Chat message is required.');
    }
    return this.aiService.processChatOrder({
      message: dto.message,
      conversationHistory: dto.conversationHistory,
      currentOrderDraft: dto.currentOrderDraft,
    });
  }

  @Post('ai/voice')
  async processVoiceOrder(@Body() dto: VoiceOrderDto) {
    return this.aiService.processVoiceOrder({
      spokenText: dto.spokenText,
      customerName: dto.customerName,
      currentOrderDraft: dto.currentOrderDraft,
    });
  }

  @Post('ai/upload-po')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
        if (allowed.includes(ext)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Invalid file format "${ext}". Only PDF (.pdf), Images (.jpg, .jpeg, .png), and Word documents (.doc, .docx) are allowed.`,
            ),
            false,
          );
        }
      },
    }),
  )
  async uploadPoDocument(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('PO Document file is required.');
    }
    const result = await this.aiService.extractFromPoDocument(file.path, file.originalname);
    return {
      success: true,
      extractedDraft: result,
      fileName: file.originalname,
      fileSize: file.size,
    };
  }
}
