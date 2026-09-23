import { Injectable, Logger } from '@nestjs/common';
import { HttpClientService } from '../../shared/http-client.service';

@Injectable()
export class PinterestService {
  private readonly logger = new Logger(PinterestService.name);
  
  constructor(private readonly http: HttpClientService) {}

  /**
   * Fetches the Pinterest Boards for the authenticated user.
   */
  async getBoards(accessToken: string, apiBaseUrl?: string, apiVersion?: string): Promise<any[]> {
    if (!accessToken) {
      throw new Error('Access token is required to fetch Pinterest boards.');
    }
    const baseUrl = apiBaseUrl && apiVersion ? `${apiBaseUrl}/${apiVersion}` : 'https://api-sandbox.pinterest.com/v5';
    const url = `${baseUrl}/boards`;
    try {
      this.logger.log(`Fetching Pinterest boards`);
      const response = await this.http.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Cookie': '_ir=0'
        }
      });
      if (response.data && response.data.items) {
        return response.data.items.map((item: any) => ({
          id: item.id,
          name: item.name,
          description: item.description
        }));
      }
      return [];
    } catch (error: any) {
      this.logger.error(`Failed to fetch Pinterest boards: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.message || error.message);
    }
  }

  /**
   * Publishes a pin with a single image
   */
  async publishImage(boardId: string, title: string, description: string, link: string, imageUrl: string, accessToken: string, apiBaseUrl?: string, apiVersion?: string): Promise<string> {
    if (!boardId || !accessToken || !imageUrl) {
      throw new Error('Board ID, Image URL, or Access Token is missing.');
    }

    const baseUrl = apiBaseUrl && apiVersion ? `${apiBaseUrl}/${apiVersion}` : 'https://api-sandbox.pinterest.com/v5';
    const url = `${baseUrl}/pins`;
    const payload: any = {
      board_id: boardId,
      title: title,
      link: link,
      media_source: {
        source_type: "image_url",
        url: imageUrl
      }
    };
    if (description) {
      payload.description = description;
    }

    try {
      this.logger.log(`Publishing image pin to board: ${boardId}`);
      const response = await this.http.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Cookie': '_ir=0'
        }
      });
      
      if (response.data && response.data.id) {
        this.logger.log(`Pin published successfully! Pin ID: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Pinterest API (missing pin ID)');
    } catch (error: any) {
      this.logger.error(`Failed to publish Pinterest pin: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.message || error.message);
    }
  }

  /**
   * Publishes a pin with a carousel of images
   */
  async publishCarousel(boardId: string, title: string, description: string, link: string, imageUrls: string[], accessToken: string, apiBaseUrl?: string, apiVersion?: string): Promise<string> {
    if (!boardId || !accessToken || !imageUrls || imageUrls.length < 2) {
      throw new Error('Board ID, multiple Image URLs, or Access Token is missing.');
    }

    const baseUrl = apiBaseUrl && apiVersion ? `${apiBaseUrl}/${apiVersion}` : 'https://api-sandbox.pinterest.com/v5';
    const url = `${baseUrl}/pins`;
    const payload: any = {
      board_id: boardId,
      title: title,
      link: link,
      media_source: {
        source_type: "multiple_image_urls",
        items: imageUrls.map(img => ({ url: img }))
      }
    };
    if (description) {
      payload.description = description;
    }

    try {
      this.logger.log(`Publishing carousel pin to board: ${boardId}`);
      const response = await this.http.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Cookie': '_ir=0'
        }
      });
      
      if (response.data && response.data.id) {
        this.logger.log(`Carousel pin published successfully! Pin ID: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Pinterest API (missing pin ID)');
    } catch (error: any) {
      this.logger.error(`Failed to publish Pinterest carousel: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.message || error.message);
    }
  }
}
