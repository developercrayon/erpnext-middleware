import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Unit } from '../../database/entities/unit.entity';
import { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';

@Injectable()
export class UnitService {
  constructor(
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
  ) {}

  async findAll(page: number, limit: number, search: string) {
    const query = this.unitRepository.createQueryBuilder('unit');

    if (search) {
      query.where(
        'unit.erpnext ILIKE :search OR unit.amazon ILIKE :search OR unit.flipkart ILIKE :search',
        { search: `%${search}%` }
      );
    }

    query.orderBy('unit.updatedAt', 'DESC');
    query.addOrderBy('unit.erpnext', 'ASC');
    query.skip((page - 1) * limit);
    query.take(limit);

    const [data, total] = await query.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
    };
  }

  async findOne(id: string) {
    const unit = await this.unitRepository.findOne({ where: { id } });
    if (!unit) throw new NotFoundException(`Unit with ID ${id} not found`);
    return unit;
  }

  async create(dto: CreateUnitDto) {
    const unit = this.unitRepository.create(dto);
    return this.unitRepository.save(unit);
  }

  async update(id: string, dto: UpdateUnitDto) {
    const unit = await this.findOne(id);
    this.unitRepository.merge(unit, dto);
    return this.unitRepository.save(unit);
  }

  async remove(id: string) {
    const unit = await this.findOne(id);
    return this.unitRepository.remove(unit);
  }
}
