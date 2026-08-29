import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SocialPost, SocialPostStatus } from '../../database/entities/social-post.entity';
import { SocialCampaign } from '../../database/entities/social-campaign.entity';
import { CreateSocialPostDto, UpdateSocialPostDto, ScheduleSocialPostDto } from './social-posts.dto';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

@Injectable()
export class SocialPostsService {
  constructor(
    @InjectRepository(SocialPost)
    private readonly postRepo: Repository<SocialPost>,
    @InjectRepository(SocialCampaign)
    private readonly campaignRepo: Repository<SocialCampaign>,
    @InjectQueue(QUEUE_NAMES.AI)
    private readonly aiQueue: Queue,
  ) {}

  async getCampaigns(): Promise<SocialCampaign[]> {
    return this.campaignRepo.find({ order: { createdAt: 'DESC' } });
  }

  async getPosts(page = 1, limit = 10, platform?: string, search?: string) {
    const query = this.postRepo.createQueryBuilder('post')
      .leftJoinAndMapOne('post.campaign', SocialCampaign, 'campaign', 'campaign.id = post.campaignId')
      .orderBy('post.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (platform) {
      query.andWhere('post.platform = :platform', { platform });
    }

    if (search) {
      query.andWhere('post.productItemCode ILIKE :search', { search: `%${search}%` });
    }

    const [items, total] = await query.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPostById(id: string): Promise<SocialPost> {
    const post = await this.postRepo.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException(`Social Post with ID ${id} not found`);
    }
    return post;
  }

  async generatePost(dto: CreateSocialPostDto): Promise<SocialPost> {
    const post = this.postRepo.create({
      ...dto,
      status: SocialPostStatus.GENERATING,
    });

    const savedPost = await this.postRepo.save(post);

    // Enqueue background job to generate content
    await this.aiQueue.add(
      JOB_NAMES.AI_GENERATE_SOCIAL_POST,
      {
        socialPostId: savedPost.id,
        productItemCode: savedPost.productItemCode,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return savedPost;
  }

  async updatePost(id: string, dto: UpdateSocialPostDto): Promise<SocialPost> {
    const post = await this.getPostById(id);
    Object.assign(post, dto);
    return this.postRepo.save(post);
  }

  async schedulePost(id: string, dto: ScheduleSocialPostDto): Promise<SocialPost> {
    const post = await this.getPostById(id);
    post.scheduledAt = new Date(dto.scheduledAt);
    post.status = SocialPostStatus.SCHEDULED;
    return this.postRepo.save(post);
  }
}
