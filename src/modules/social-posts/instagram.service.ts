import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class InstagramService {
  private readonly logger = new Logger(InstagramService.name);
  private readonly API_VERSION = 'v19.0';
  private readonly BASE_URL = `https://graph.facebook.com/${this.API_VERSION}`;

  async getPages(accessToken: string): Promise<any[]> {
    if (!accessToken) {
      throw new Error('Access token is required to fetch pages.');
    }
    const url = `${this.BASE_URL}/me/accounts`;
    try {
      this.logger.log(`Fetching Facebook pages`);
      const response = await axios.get(url, { params: { access_token: accessToken } });
      if (response.data && response.data.data) {
        return response.data.data;
      }
      return [];
    } catch (error: any) {
      this.logger.error(`Failed to fetch pages: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }

  async getBusinessAccount(pageId: string, accessToken: string): Promise<string> {
    if (!pageId || !accessToken) {
      throw new Error('Page ID and Access Token are required.');
    }
    const url = `${this.BASE_URL}/${pageId}`;
    try {
      this.logger.log(`Fetching Instagram business account for page: ${pageId}`);
      const response = await axios.get(url, { 
        params: { 
          fields: 'instagram_business_account',
          access_token: accessToken 
        } 
      });
      if (response.data && response.data.instagram_business_account && response.data.instagram_business_account.id) {
        return response.data.instagram_business_account.id;
      }
      throw new Error('No Instagram Business Account connected to this page.');
    } catch (error: any) {
      this.logger.error(`Failed to fetch business account: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Uploads an image to create an Instagram media container.
   * Returns the container ID (creation_id).
   */
  async createMediaContainer(imageUrl: string, caption: string, igUserId: string, accessToken: string): Promise<string> {
    if (!igUserId || !accessToken) {
      throw new Error('Instagram Account ID or Access Token is missing.');
    }

    const url = `${this.BASE_URL}/${igUserId}/media`;
    const params = {
      image_url: imageUrl,
      caption: caption,
      access_token: accessToken,
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
  async publishMedia(creationId: string, igUserId: string, accessToken: string): Promise<string> {
    if (!igUserId || !accessToken) {
      throw new Error('Instagram Account ID or Access Token is missing.');
    }

    const url = `${this.BASE_URL}/${igUserId}/media_publish`;
    const params = {
      creation_id: creationId,
      access_token: accessToken,
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

  /**
   * Uploads an image to create an Instagram media container for a carousel item.
   * Returns the container ID.
   */
  async createCarouselItemContainer(imageUrl: string, igUserId: string, accessToken: string): Promise<string> {
    if (!igUserId || !accessToken) {
      throw new Error('Instagram Account ID or Access Token is missing.');
    }

    const url = `${this.BASE_URL}/${igUserId}/media`;
    const params = {
      image_url: imageUrl,
      is_carousel_item: true,
      access_token: accessToken,
    };

    try {
      this.logger.log(`Creating carousel item container for image: ${imageUrl}`);
      const response = await axios.post(url, null, { params });
      
      if (response.data && response.data.id) {
        this.logger.log(`Carousel item container created successfully: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Instagram API (missing container ID)');
    } catch (error: any) {
      this.logger.error(`Failed to create Instagram carousel item: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Creates a parent carousel container linking multiple carousel items.
   * Returns the parent container ID.
   */
  async createCarouselContainer(childrenIds: string[], caption: string, igUserId: string, accessToken: string): Promise<string> {
    if (!igUserId || !accessToken) {
      throw new Error('Instagram Account ID or Access Token is missing.');
    }
    
    if (!childrenIds || childrenIds.length < 2 || childrenIds.length > 10) {
      throw new Error('Carousel posts must have between 2 and 10 items.');
    }

    const url = `${this.BASE_URL}/${igUserId}/media`;
    const params = {
      media_type: 'CAROUSEL',
      children: childrenIds.join(','),
      caption: caption,
      access_token: accessToken,
    };

    try {
      this.logger.log(`Creating carousel container with children: ${childrenIds.join(',')}`);
      const response = await axios.post(url, null, { params });
      
      if (response.data && response.data.id) {
        this.logger.log(`Carousel container created successfully: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Instagram API (missing container ID)');
    } catch (error: any) {
      this.logger.error(`Failed to create Instagram carousel container: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }
}
