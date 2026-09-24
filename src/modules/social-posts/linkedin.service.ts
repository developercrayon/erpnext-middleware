import { Injectable, Logger } from '@nestjs/common';
import { HttpClientService } from '../../shared/http-client.service';
import axios from 'axios';

@Injectable()
export class LinkedinService {
  private readonly logger = new Logger(LinkedinService.name);

  constructor(private readonly http: HttpClientService) { }

  private getHeaders(accessToken: string) {
    return {
      'Authorization': `Bearer ${accessToken}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'Linkedin-Version': '202609',
      'Content-Type': 'application/json'
    };
  }

  async publishText(pageId: string, text: string, accessToken: string): Promise<string> {
    if (!pageId || !accessToken) {
      throw new Error('Page ID or Access Token is missing.');
    }
    const url = 'https://api.linkedin.com/rest/posts';
    const payload = {
      author: `urn:li:organization:${pageId}`,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    };

    try {
      this.logger.log(`Publishing text post to LinkedIn page: ${pageId}`);
      const response = await this.http.post(url, payload, { headers: this.getHeaders(accessToken) });
      const id = response.headers?.['x-restli-id'] || response.headers?.['x-linkedin-id'] || 'success';
      this.logger.log(`LinkedIn post published successfully!`);
      return id;
    } catch (error: any) {
      this.logger.error(`Failed to publish LinkedIn text post: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.message || error.message);
    }
  }

  async uploadImage(pageId: string, imageUrl: string, accessToken: string): Promise<string> {
    // 1. Initialize Upload
    const initUrl = 'https://api.linkedin.com/rest/images?action=initializeUpload';
    const initPayload = {
      initializeUploadRequest: {
        owner: `urn:li:organization:${pageId}`
      }
    };

    let uploadUrl = '';
    let imageUrn = '';
    try {
      const initResponse = await this.http.post(initUrl, initPayload, { headers: this.getHeaders(accessToken) });
      uploadUrl = initResponse.data?.value?.uploadUrl;
      imageUrn = initResponse.data?.value?.image;

      if (!uploadUrl || !imageUrn) {
        throw new Error('Invalid response from initializeUpload');
      }
    } catch (error: any) {
      this.logger.error(`Failed to initialize LinkedIn image upload: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.message || error.message);
    }

    // 2. Fetch image binary data
    let imageBuffer: Buffer;
    let contentType = 'image/png';
    try {
      const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      imageBuffer = imgResponse.data;
      contentType = (imgResponse.headers['content-type'] as string) || 'image/png';
    } catch (error: any) {
      this.logger.error(`Failed to fetch image from URL: ${imageUrl}`);
      throw new Error(`Cannot download image: ${error.message}`);
    }

    // 3. Upload image binary
    try {
      await axios.put(uploadUrl, imageBuffer, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': contentType
        }
      });
      return imageUrn;
    } catch (error: any) {
      this.logger.error(`Failed to upload image binary to LinkedIn: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.message || error.message);
    }
  }

  async publishImage(pageId: string, commentary: string, imageUrl: string, accessToken: string): Promise<string> {
    if (!pageId || !accessToken || !imageUrl) {
      throw new Error('Page ID, Image URL, or Access Token is missing.');
    }

    const imageUrn = await this.uploadImage(pageId, imageUrl, accessToken);

    const url = 'https://api.linkedin.com/rest/posts';
    const payload = {
      author: `urn:li:organization:${pageId}`,
      commentary: commentary,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      content: {
        media: {
          id: imageUrn
        }
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    };

    try {
      this.logger.log(`Publishing image post to LinkedIn page: ${pageId}`);
      const response = await this.http.post(url, payload, { headers: this.getHeaders(accessToken) });
      const id = response.headers?.['x-restli-id'] || response.headers?.['x-linkedin-id'] || 'success';
      this.logger.log(`LinkedIn image post published successfully!`);
      return id;
    } catch (error: any) {
      this.logger.error(`Failed to publish LinkedIn image post: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.message || error.message);
    }
  }

  async publishCarousel(pageId: string, commentary: string, imageUrls: string[], accessToken: string): Promise<string> {
    if (!pageId || !accessToken || !imageUrls || imageUrls.length < 2) {
      throw new Error('Page ID, multiple Image URLs, or Access Token is missing.');
    }

    const imageUrns = [];
    for (const url of imageUrls) {
      const urn = await this.uploadImage(pageId, url, accessToken);
      imageUrns.push(urn);
    }

    const url = 'https://api.linkedin.com/rest/posts';
    const payload = {
      author: `urn:li:organization:${pageId}`,
      commentary: commentary,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      content: {
        multiImage: {
          images: imageUrns.map(urn => ({ id: urn }))
        }
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false
    };

    try {
      this.logger.log(`Publishing carousel post to LinkedIn page: ${pageId}`);
      const response = await this.http.post(url, payload, { headers: this.getHeaders(accessToken) });
      const id = response.headers?.['x-restli-id'] || response.headers?.['x-linkedin-id'] || 'success';
      this.logger.log(`LinkedIn carousel post published successfully!`);
      return id;
    } catch (error: any) {
      this.logger.error(`Failed to publish LinkedIn carousel post: ${error?.response?.data ? JSON.stringify(error.response.data) : error.message}`);
      throw new Error(error?.response?.data?.message || error.message);
    }
  }
}
