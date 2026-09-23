import { Injectable, Logger } from '@nestjs/common';
import { HttpClientService } from '../../shared/http-client.service';

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);
  private readonly API_VERSION = 'v19.0';
  private readonly BASE_URL = `https://graph.facebook.com/${this.API_VERSION}`;

  constructor(private readonly http: HttpClientService) {}

  /**
   * Fetches the Facebook Pages the user manages.
   */
  async getPages(accessToken: string): Promise<any[]> {
    if (!accessToken) {
      throw new Error('Access token is required to fetch pages.');
    }
    const url = `${this.BASE_URL}/me/accounts`;
    try {
      this.logger.log(`Fetching Facebook pages`);
      const response = await this.http.get(url, { params: { access_token: accessToken } });
      if (response.data && response.data.data) {
        return response.data.data;
      }
      return [];
    } catch (error: any) {
      this.logger.error(`Failed to fetch Facebook pages: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Publishes a text-only message to a Facebook Page feed.
   */
  async publishMessage(message: string, pageId: string, accessToken: string, scheduledTime?: number): Promise<string> {
    if (!pageId || !accessToken) {
      throw new Error('Facebook Page ID or Access Token is missing.');
    }

    const url = `${this.BASE_URL}/${pageId}/feed`;
    const params: any = {
      message,
      access_token: accessToken,
    };

    if (scheduledTime) {
      params.published = false;
      params.scheduled_publish_time = scheduledTime;
    }

    try {
      this.logger.log(`Publishing message to Facebook Page: ${pageId}`);
      const response = await this.http.post(url, null, { params });
      
      if (response.data && response.data.id) {
        this.logger.log(`Message published successfully! Post ID: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Facebook API (missing post ID)');
    } catch (error: any) {
      this.logger.error(`Failed to publish Facebook message: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Publishes a single photo to a Facebook Page feed.
   */
  async publishImage(imageUrl: string, message: string, pageId: string, accessToken: string, scheduledTime?: number): Promise<string> {
    if (!pageId || !accessToken) {
      throw new Error('Facebook Page ID or Access Token is missing.');
    }

    const url = `${this.BASE_URL}/${pageId}/photos`;
    const params: any = {
      url: imageUrl,
      message,
      access_token: accessToken,
    };

    if (scheduledTime) {
      params.published = false;
      params.scheduled_publish_time = scheduledTime;
    }

    try {
      this.logger.log(`Publishing photo to Facebook Page: ${pageId}`);
      const response = await this.http.post(url, null, { params });
      
      if (response.data && response.data.id) {
        this.logger.log(`Photo published successfully! Post ID: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Facebook API (missing post ID)');
    } catch (error: any) {
      this.logger.error(`Failed to publish Facebook photo: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Uploads a single photo for a carousel (unpublished).
   * Returns the media_fbid.
   */
  async uploadCarouselPhoto(imageUrl: string, pageId: string, accessToken: string): Promise<string> {
    if (!pageId || !accessToken) {
      throw new Error('Facebook Page ID or Access Token is missing.');
    }

    const url = `${this.BASE_URL}/${pageId}/photos`;
    const params = {
      url: imageUrl,
      published: false,
      access_token: accessToken,
    };

    try {
      this.logger.log(`Uploading carousel photo to Facebook Page: ${pageId}`);
      const response = await axios.post(url, null, { params });
      
      if (response.data && response.data.id) {
        this.logger.log(`Carousel photo uploaded successfully! Media FBID: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Facebook API (missing media FBID)');
    } catch (error: any) {
      this.logger.error(`Failed to upload Facebook carousel photo: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Publishes a carousel to a Facebook Page feed using uploaded media FBIDs.
   */
  async publishCarousel(mediaFbids: string[], message: string, pageId: string, accessToken: string, scheduledTime?: number): Promise<string> {
    if (!pageId || !accessToken) {
      throw new Error('Facebook Page ID or Access Token is missing.');
    }

    const url = `${this.BASE_URL}/${pageId}/feed`;
    const params: any = {
      message,
      access_token: accessToken,
    };

    mediaFbids.forEach((fbid, index) => {
      params[`attached_media[${index}]`] = JSON.stringify({ media_fbid: fbid });
    });

    if (scheduledTime) {
      params.published = false;
      params.scheduled_publish_time = scheduledTime;
    }

    try {
      this.logger.log(`Publishing carousel to Facebook Page: ${pageId}`);
      const response = await this.http.post(url, null, { params });
      
      if (response.data && response.data.id) {
        this.logger.log(`Carousel published successfully! Post ID: ${response.data.id}`);
        return response.data.id;
      }
      throw new Error('Invalid response from Facebook API (missing post ID)');
    } catch (error: any) {
      this.logger.error(`Failed to publish Facebook carousel: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }

  /**
   * Uploads an image as a Facebook story.
   */
  async publishStory(imageUrl: string, pageId: string, accessToken: string, scheduledTime?: number): Promise<string> {
    if (!pageId || !accessToken) {
      throw new Error('Facebook Page ID or Access Token is missing.');
    }

    // Step 1: Upload the photo unpublished
    const uploadUrl = `${this.BASE_URL}/${pageId}/photos`;
    const uploadParams = {
      url: imageUrl,
      published: false,
      access_token: accessToken,
    };

    let photoId: string;
    try {
      this.logger.log(`Uploading story photo to Facebook Page: ${pageId}`);
      const uploadResponse = await axios.post(uploadUrl, null, { params: uploadParams });
      
      if (uploadResponse.data && uploadResponse.data.id) {
        photoId = uploadResponse.data.id;
        this.logger.log(`Story photo uploaded successfully! Media FBID: ${photoId}`);
      } else {
        throw new Error('Invalid response from Facebook API (missing media FBID)');
      }
    } catch (error: any) {
      this.logger.error(`Failed to upload Facebook story photo: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }

    // Step 2: Publish as story
    const storyUrl = `${this.BASE_URL}/${pageId}/photo_stories`;
    const storyParams: any = {
      photo_id: photoId,
      access_token: accessToken,
    };

    if (scheduledTime) {
      storyParams.published = false;
      storyParams.scheduled_publish_time = scheduledTime;
    }

    try {
      this.logger.log(`Publishing story to Facebook Page: ${pageId}`);
      const storyResponse = await axios.post(storyUrl, null, { params: storyParams });
      
      if (storyResponse.data && storyResponse.data.id) {
        this.logger.log(`Story published successfully! Story ID: ${storyResponse.data.id}`);
        return storyResponse.data.id; // Returns story_id
      } else if (storyResponse.data && storyResponse.data.success) {
        this.logger.log(`Story published successfully!`);
        return 'success';
      }
      throw new Error('Invalid response from Facebook API while publishing story');
    } catch (error: any) {
      this.logger.error(`Failed to publish Facebook story: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.error?.message || error.message);
    }
  }
}
