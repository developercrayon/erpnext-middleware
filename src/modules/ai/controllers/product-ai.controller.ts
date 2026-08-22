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
  async triggerImageGeneration(@Param('id') id: string) {
    const data = await this.productAiService.triggerImageGeneration(id);
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
    @Param('index') index: string,
    @Res() res: Response,
  ) {
    const data = await this.productAiService.getAiProductData(dataId);

    if (index === 'original') {
      let ext = 'jpg'; // We'll try common extensions since we don't save the extension in DB explicitly, though we could check the file system.
      let basePath = require('path').join(process.cwd(), 'public', 'generated_images', dataId, 'original');
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

    if (!data.generatedImages || !data.generatedImages[parseInt(index, 10)]) {
      throw new NotFoundException('Image not found');
    }

    const image = data.generatedImages[parseInt(index, 10)];

    if (!fs.existsSync(image.file_path)) {
      this.logger.error(`File not found at path: ${image.file_path}`);
      throw new NotFoundException('Image file missing from disk');
    }

    res.setHeader('Content-Type', image.mime_type);

    // Read and stream the file
    const fileStream = fs.createReadStream(image.file_path);
    fileStream.pipe(res);
  }
}
