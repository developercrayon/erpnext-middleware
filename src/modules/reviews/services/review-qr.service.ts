import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';

@Injectable()
export class ReviewQrService {
  private readonly logger = new Logger(ReviewQrService.name);

  constructor(private readonly configService: ConfigService) {}

  getBaseReviewUrl(): string {
    return (
      this.configService.get<string>('REVIEW_APP_URL') ||
      'http://localhost:3001'
    );
  }

  getReviewUrl(token: string, source?: string): string {
    const baseUrl = this.getBaseReviewUrl().replace(/\/+$/, '');
    if (!source || source.toUpperCase() === 'DIRECT') {
      return `${baseUrl}/ocr/review/${token}`;
    }
    return `${baseUrl}/ocr/review/${token}?source=${source.toUpperCase()}`;
  }

  async generateQrDataUrl(
    token: string,
    source: string = 'invoice',
    options?: { width?: number; margin?: number },
  ): Promise<string> {
    const url = this.getReviewUrl(token, source);
    try {
      return await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'H',
        margin: options?.margin ?? 2,
        width: options?.width ?? 300,
        color: {
          dark: '#2D2824', // Warm Woodwolff Charcoal
          light: '#FFFFFF',
        },
      });
    } catch (error) {
      this.logger.error(`Failed to generate QR data URL: ${error.message}`);
      throw error;
    }
  }

  async generateQrSvg(
    token: string,
    source: string = 'invoice',
    options?: { width?: number; margin?: number },
  ): Promise<string> {
    const url = this.getReviewUrl(token, source);
    try {
      return await QRCode.toString(url, {
        type: 'svg',
        errorCorrectionLevel: 'H',
        margin: options?.margin ?? 2,
        width: options?.width ?? 300,
        color: {
          dark: '#2D2824',
          light: '#FFFFFF',
        },
      });
    } catch (error) {
      this.logger.error(`Failed to generate QR SVG: ${error.message}`);
      throw error;
    }
  }

  async generateQrBuffer(
    token: string,
    source: string = 'invoice',
    options?: { width?: number; margin?: number },
  ): Promise<Buffer> {
    const url = this.getReviewUrl(token, source);
    try {
      return await QRCode.toBuffer(url, {
        type: 'png',
        errorCorrectionLevel: 'H',
        margin: options?.margin ?? 2,
        width: options?.width ?? 300,
        color: {
          dark: '#2D2824', // Warm Woodwolff Charcoal
          light: '#FFFFFF',
        },
      });
    } catch (error) {
      this.logger.error(`Failed to generate QR buffer: ${error.message}`);
      throw error;
    }
  }

  getInvoiceCtaText(): { title: string; subtitle: string; footer: string } {
    return {
      title: 'How did we do?',
      subtitle: 'Scan & share your Woodwolff experience.',
      footer: 'Your feedback helps us craft better wooden pieces.',
    };
  }
}

