import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AmazonVariantMapping } from '../../database/entities/amazon-variant-mapping.entity';

@Injectable()
export class AmazonVariantMappingService {
  constructor(
    @InjectRepository(AmazonVariantMapping)
    private readonly repo: Repository<AmazonVariantMapping>,
  ) {}

  async findAll(page: number = 1, limit: number = 50) {
    const [data, total] = await this.repo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });
    return { data, total, page, limit };
  }

  async create(createDto: Partial<AmazonVariantMapping>) {
    const mapping = this.repo.create(createDto);
    return this.repo.save(mapping);
  }

  async remove(id: string) {
    const result = await this.repo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Mapping with ID ${id} not found`);
    }
    return { success: true };
  }
}
