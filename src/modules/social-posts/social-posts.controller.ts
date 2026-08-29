import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SocialPostsService } from './social-posts.service';
import { CreateSocialPostDto, UpdateSocialPostDto, ScheduleSocialPostDto } from './social-posts.dto';

@Controller('social-posts')
@UseGuards(AuthGuard('jwt'))
export class SocialPostsController {
  constructor(private readonly postsService: SocialPostsService) {}

  @Get('campaigns')
  async getCampaigns() {
    return this.postsService.getCampaigns();
  }

  @Get()
  async getPosts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('platform') platform?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.postsService.getPosts(pageNum, limitNum, platform, search);
  }

  @Get(':id')
  async getPost(@Param('id') id: string) {
    return this.postsService.getPostById(id);
  }

  @Post('generate')
  async generatePost(@Body() dto: CreateSocialPostDto) {
    return this.postsService.generatePost(dto);
  }

  @Put(':id')
  async updatePost(@Param('id') id: string, @Body() dto: UpdateSocialPostDto) {
    return this.postsService.updatePost(id, dto);
  }

  @Put(':id/schedule')
  async schedulePost(@Param('id') id: string, @Body() dto: ScheduleSocialPostDto) {
    return this.postsService.schedulePost(id, dto);
  }
}
