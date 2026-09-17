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
import { PurchasingService } from './purchasing.service';
import { DocumentProcessingService } from '../document-processing/document-processing.service';
import { ErpNextService } from '../purchasing-erpnext/erpnext.service';
import { AuditService } from '../audit/audit.service';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const uploadStorage = diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.resolve(process.cwd(), 'uploads');
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

@Controller('purchasing')
export class PurchasingController {
  constructor(
    private readonly purchasingService: PurchasingService,
    private readonly docProcessingService: DocumentProcessingService,
    private readonly erpNextService: ErpNextService,
    private readonly auditService: AuditService,
  ) {}

  @Post('purchase-invoices/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage,
      fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext) || !ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Unsupported file format (${ext || file.mimetype}). Only PDF, JPG, JPEG, PNG, DOC, and DOCX files are allowed.`
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadInvoice(
    @UploadedFile() file: Express.Multer.File,
    @Body('user') user?: string,
  ) {
    if (!file) {
      throw new BadRequestException('File is required.');
    }
    const doc = await this.docProcessingService.createDocumentRecord(file, user || 'User');
    return {
      id: doc.id,
      file_name: doc.file_name,
      file_size: doc.file_size,
      status: doc.status,
      message: 'Invoice document uploaded successfully. AI processing queued.',
    };
  }

  @Post('purchase-invoices/manual')
  async createManualInvoice(
    @Body() body: any,
    @Query('user') user?: string,
  ) {
    return this.purchasingService.createManualPurchaseInvoice(body, user || 'User');
  }

  @Get('purchase-invoices')
  async getAllInvoices(
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.purchasingService.getAllInvoices(status, search);
  }

  @Get('purchase-invoices/:id')
  async getInvoiceById(@Param('id') id: string) {
    return this.purchasingService.getInvoiceById(id);
  }

  @Get('purchase-invoices/:id/status')
  async getInvoiceStatus(@Param('id') id: string) {
    return this.purchasingService.getProcessingStatus(id);
  }

  @Get('purchase-invoices/:id/extraction')
  async getInvoiceExtraction(@Param('id') id: string) {
    const doc = await this.purchasingService.getInvoiceById(id);
    return {
      id: doc.id,
      extracted_data: doc.extracted_data,
      normalized_data: doc.normalized_data,
      matching_result: doc.supplier_matching_result,
      validation_result: doc.validation_result,
      confidence_score: doc.confidence_score,
    };
  }

  @Patch('purchase-invoices/:id')
  async updateInvoice(
    @Param('id') id: string,
    @Body() body: any,
    @Query('user') user?: string,
  ) {
    return this.purchasingService.updateInvoiceData(id, body, user || 'User');
  }

  @Post('purchase-invoices/:id/validate')
  async validateInvoice(@Param('id') id: string) {
    return this.purchasingService.validateInvoiceExplicit(id);
  }

  @Post('purchase-invoices/:id/approve')
  async approveInvoice(
    @Param('id') id: string,
    @Body('user') user?: string,
  ) {
    return this.purchasingService.approveAndCreateInErp(id, user || 'User');
  }

  @Post('purchase-invoices/:id/create-erpnext')
  async createInErpNext(
    @Param('id') id: string,
    @Body('user') user?: string,
  ) {
    return this.purchasingService.approveAndCreateInErp(id, user || 'User');
  }

  @Post('purchase-invoices/:id/retry')
  async retryInvoice(@Param('id') id: string) {
    const doc = await this.purchasingService.getInvoiceById(id);
    if (doc.status === 'FAILED' && doc.extracted_data) {
      return this.purchasingService.approveAndCreateInErp(id);
    }
    return this.docProcessingService.retryProcessing(id);
  }

  @Delete('purchase-invoices/:id')
  async deleteInvoice(@Param('id') id: string) {
    return this.purchasingService.deleteInvoice(id);
  }

  @Get('suppliers')
  async getSuppliers(@Query('query') query?: string) {
    if (query) {
      return this.erpNextService.searchSupplierByNameOrGstin(query);
    }
    return this.erpNextService.getAllSuppliers();
  }

  @Post('suppliers')
  async addSupplier(@Body() body: any) {
    return this.erpNextService.addSupplier(body);
  }

  @Get('items')
  async getItems(@Query('query') query?: string) {
    if (query) {
      return this.erpNextService.searchItems(query);
    }
    return this.erpNextService.getAllItems();
  }

  @Post('items')
  async addItem(@Body() body: any) {
    return this.erpNextService.addItem(body);
  }

  @Post('sync-erpnext-masters')
  async syncMasterData() {
    return this.erpNextService.syncMasterDataFromErpNext();
  }

  @Get('audit-logs/:id')
  async getAuditLogs(@Param('id') id: string) {
    return this.auditService.getLogsByEntity('PURCHASE_INVOICE_DOCUMENT', id);
  }

  @Get('dashboard/stats')
  async getDashboardStats() {
    return this.purchasingService.getDashboardStats();
  }
}
