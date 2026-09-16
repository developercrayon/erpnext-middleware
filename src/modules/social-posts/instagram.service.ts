import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly API_VERSION = 'v19.0';
  private readonly BASE_URL = `https://graph.facebook.com/${this.API_VERSION}`;

  private get igUserId(): string {
    return process.env.INSTAGRAM_ACCOUNT_ID || '';
  }

  private get accessToken(): string {
    return process.env.META_ACCESS_TOKEN || '';
  }

  /**
   * Uploads an image to create an Instagram media container.
   * Returns the container ID (creation_id).
   */
  async createMediaContainer(imageUrl: string, caption: string): Promise<string> {
    if (!this.igUserId || !this.accessToken) {
      throw new Error('INSTAGRAM_ACCOUNT_ID or META_ACCESS_TOKEN is missing in environment variables.');
    }

    const url = `${this.BASE_URL}/${this.igUserId}/media`;
    const params = {
      image_url: imageUrl,
      caption: caption,
      access_token: this.accessToken,
    };

    try {
      this.logger.log(`Creating media container for image: ${imageUrl}`);
      const response = await axios.post(url, null, { params });
      
      if (response.data && response.data.id) {
        this.logger.log(`Media container created successfully: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Instagram API (missing container ID)');
    } catch (error: any) {
      this.logger.error(`Failed to create Instagram media container: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Publishes an uploaded media container to the Instagram feed.
   * Returns the Instagram Post ID.
   */
  async publishMedia(creationId: string): Promise<string> {
    if (!this.igUserId || !this.accessToken) {
      throw new Error('INSTAGRAM_ACCOUNT_ID or META_ACCESS_TOKEN is missing in environment variables.');
    }

    const url = `${this.BASE_URL}/${this.igUserId}/media_publish`;
    const params = {
      creation_id: creationId,
      access_token: this.accessToken,
    };

    try {
      this.logger.log(`Publishing media container: ${creationId}`);
      const response = await axios.post(url, null, { params });
      
      if (response.data && response.data.id) {
        this.logger.log(`Media published successfully to Instagram! Post ID: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Instagram API (missing post ID)');
    } catch (error: any) {
      this.logger.error(`Failed to publish Instagram media: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }
}
