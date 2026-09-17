import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReviewQrService } from './review-qr.service';

export interface EmailDispatchPayload {
  to: string;
  customerName: string;
  orderId: string;
  reviewUrl: string;
  items: Array<{ name: string; imageUrl?: string }>;
}

export interface WhatsAppDispatchPayload {
  phone: string;
  customerName: string;
  orderId: string;
  reviewUrl: string;
  items: Array<{ name: string }>;
}

@Injectable()
export class ReviewNotificationService {
  private readonly logger = new Logger(ReviewNotificationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly qrService: ReviewQrService,
  ) {}

  generateEmailTemplate(payload: EmailDispatchPayload): { subject: string; html: string } {
    const subject = `How are you enjoying your Woodwolff piece? ❤️ (Order #${payload.orderId})`;
    const html = `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #FAF7F2; padding: 40px 20px; color: #2D2824;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="font-size: 26px; letter-spacing: 2px; text-transform: uppercase; margin: 0; color: #3A2F25;">WOODWOLFF</h1>
          <p style="font-size: 13px; color: #8C7E72; margin-top: 4px;">Artisan Handcrafted Woodwork</p>
        </div>
        <div style="background: #FFFFFF; border-radius: 12px; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.04);">
          <h2 style="font-size: 20px; margin-top: 0; color: #2D2824;">Hi ${payload.customerName || 'there'} 👋</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #5C5248;">
            We hope your new Woodwolff piece has found a wonderful place in your home. We would love to hear your thoughts!
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${payload.reviewUrl}" style="background-color: #7A5538; color: #FFFFFF; padding: 14px 32px; border-radius: 8px; font-weight: 600; text-decoration: none; display: inline-block; font-size: 16px;">
              ⭐ Rate Your Experience
            </a>
          </div>
          <p style="font-size: 13px; text-align: center; color: #A09387; margin-bottom: 0;">
            It takes less than 60 seconds. You can even speak your review!
          </p>
        </div>
      </div>
    `;
    return { subject, html };
  }

  generateWhatsAppMessage(payload: WhatsAppDispatchPayload): string {
    return (
      `Hi ${payload.customerName || 'there'} 👋\n\n` +
      `How are you enjoying your handcrafted Woodwolff piece from Order #${payload.orderId}? ❤️\n\n` +
      `We'd love to hear your experience:\n` +
      `⭐ Rate Us: ${payload.reviewUrl}\n\n` +
      `Thank you for choosing Woodwolff!`
    );
  }

  async sendEmailReviewRequest(params: {
    token: string;
    to: string;
    customerName: string;
    orderId: string;
    items: Array<{ name: string; imageUrl?: string }>;
  }): Promise<{ success: boolean; messageId?: string }> {
    const reviewUrl = this.qrService.getReviewUrl(params.token, 'email');
    const { subject } = this.generateEmailTemplate({
      to: params.to,
      customerName: params.customerName,
      orderId: params.orderId,
      reviewUrl,
      items: params.items,
    });

    this.logger.log(`[EMAIL DISPATCH] Review request to: ${params.to} | Subject: "${subject}" | URL: ${reviewUrl}`);
    // Provider integration hook (e.g. Resend, SendGrid, SES, SMTP)
    return { success: true, messageId: `mock-email-${Date.now()}` };
  }

  async sendWhatsAppReviewRequest(params: {
    token: string;
    phone: string;
    customerName: string;
    orderId: string;
    items: Array<{ name: string }>;
  }): Promise<{ success: boolean; messageId?: string }> {
    const reviewUrl = this.qrService.getReviewUrl(params.token, 'whatsapp');
    const message = this.generateWhatsAppMessage({
      phone: params.phone,
      customerName: params.customerName,
      orderId: params.orderId,
      reviewUrl,
      items: params.items,
    });

    this.logger.log(`[WHATSAPP DISPATCH] Review request to: ${params.phone} | Text: "${message.slice(0, 80)}..."`);
    // Provider integration hook (e.g. Twilio, Gupshup, Wati, Meta Cloud API)
    return { success: true, messageId: `mock-wa-${Date.now()}` };
  }
}
