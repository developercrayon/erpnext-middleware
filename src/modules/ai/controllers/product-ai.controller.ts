import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Res,
  NotFoundException,
  Logger,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { ProductAiService } from '../services/product-ai.service';
import { CreateAiProductDataDto, UpdateAiProductContentDto } from '../dto/ai.dto';
import * as fs from 'fs';

@Controller('ai')
export class ProductAiController {
  private readonly logger = new Logger(ProductAiController.name);

  constructor(private readonly productAiService: ProductAiService) { }

  @Post('product-data')
  @UseGuards(AuthGuard('jwt'))
  async createAiProductData(@Body() dto: CreateAiProductDataDto) {
    const data = await this.productAiService.createAiProductData(dto);
    return data;
  }

  @Get('product-data')
  @UseGuards(AuthGuard('jwt'))
  async listAiProducts(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '20',
  ) {
    const data = await this.productAiService.listAiProducts(Number(page), Number(pageSize));
    return data;
  }

  @Get('product-data/:id')
  @UseGuards(AuthGuard('jwt'))
  async getAiProductData(@Param('id') id: string) {
    const data = await this.productAiService.getAiProductData(id);
    return data;
  }

  @Get('debug-google')
  async debugGoogle() {
    const { GoogleProvider } = require('../providers/google.provider');
    const google = new GoogleProvider();
    try {
      const res = await google.generateContent({
        itemName: 'Test Product',
        description: 'Test description',
        model: 'gemini-1.5-flash',
        apiKey: process.env.GOOGLE_API_KEY || '',
      });
      return { success: true, raw_response: res.raw_response };
    } catch (err: any) {
      return { success: false, error: err.message, stack: err.stack };
    }
  }

  @Patch('product-data/:id')
  @UseGuards(AuthGuard('jwt'))
  async updateGeneratedContent(
    @Param('id') id: string,
    @Body() dto: UpdateAiProductContentDto,
  ) {
    const data = await this.productAiService.updateGeneratedContent(id, dto);
    return data;
  }

  @Post('product-data/:id/generate')
  @UseGuards(AuthGuard('jwt'))
  async triggerGeneration(@Param('id') id: string) {
    const data = await this.productAiService.triggerGeneration(id);
    return data;
  }

  @Post('product-data/:id/generate-image')
  @UseGuards(AuthGuard('jwt'))
  async triggerImageGeneration(
    @Param('id') id: string,
    @Body('targetIndex') targetIndex?: number,
  ) {
    const data = await this.productAiService.triggerImageGeneration(id, targetIndex);
    return data;
  }

  @Get('product-data/:id/status')
  @UseGuards(AuthGuard('jwt'))
  async getGenerationStatus(@Param('id') id: string) {
    const data = await this.productAiService.getGenerationStatus(id);
    return data;
  }

  @Patch('product-data/:id/convert')
  @UseGuards(AuthGuard('jwt'))
  async markAsConverted(@Param('id') id: string) {
    const data = await this.productAiService.markAsConverted(id);
    return data;
  }

  @Delete('product-data/:id')
  @UseGuards(AuthGuard('jwt'))
  async deleteAiProductData(@Param('id') id: string) {
    await this.productAiService.deleteAiProductData(id);
    return { message: 'Deleted successfully' };
  }

  @Get('images/:dataId/:index')
  async serveImage(
    @Param('dataId') dataId: string,
    @Param('index') indexParam: string,
    @Res() res: Response,
  ) {
    const fs = require('fs');
    const path = require('path');
    const publicDir = path.join(process.cwd(), 'public');
    const dirPath = path.join(publicDir, 'generated_images', dataId);

    // Remove any extension like .png, .jpg from the index parameter
    const index = indexParam.split('.')[0];

    if (index === 'original') {
      let basePath = path.join(dirPath, 'original');
      let finalPath = '';
      if (fs.existsSync(`${basePath}.jpg`)) finalPath = `${basePath}.jpg`;
      else if (fs.existsSync(`${basePath}.png`)) finalPath = `${basePath}.png`;
      else if (fs.existsSync(`${basePath}.webp`)) finalPath = `${basePath}.webp`;

      if (!finalPath) {
        throw new NotFoundException('Original image not found on disk');
      }

      res.setHeader('Content-Type', `image/${finalPath.split('.').pop()}`);
      const fileStream = fs.createReadStream(finalPath);
      fileStream.pipe(res);
      return;
    }

    const imgIndex = parseInt(index, 10) + 1;
    const baseFilePath = path.join(dirPath, `image-${imgIndex}`);
    
    let filePath = '';
    let mimeType = '';
    
    // Check possible extensions
    if (fs.existsSync(`${baseFilePath}.png`)) { filePath = `${baseFilePath}.png`; mimeType = 'image/png'; }
    else if (fs.existsSync(`${baseFilePath}.jpg`)) { filePath = `${baseFilePath}.jpg`; mimeType = 'image/jpeg'; }
    else if (fs.existsSync(`${baseFilePath}.webp`)) { filePath = `${baseFilePath}.webp`; mimeType = 'image/webp'; }

    if (!filePath) {
      // Fallback: Check if the database has it stored with a custom name for Product AI
      try {
        const data = await this.productAiService.getAiProductData(dataId);
        if (data.generatedImages && data.generatedImages[parseInt(index, 10)]) {
           const image = data.generatedImages[parseInt(index, 10)];
           const customFilePath = path.join(dirPath, image.filename);
           if (fs.existsSync(customFilePath)) {
             filePath = customFilePath;
             mimeType = image.mime_type;
           }
        }
      } catch (err) {}
    }

    if (!filePath) {
      this.logger.error(`Image not found at path: ${baseFilePath}`);
      throw new NotFoundException('Image file missing from disk');
    }

    res.setHeader('Content-Type', mimeType);

    // Read and stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  }
}
