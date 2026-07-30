import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Country } from '../../database/entities/country.entity';
import { CreateCountryDto, UpdateCountryDto } from './dto/country.dto';

@Injectable()
export class CountryService {
  constructor(
    @InjectRepository(Country)
    private countryRepository: Repository<Country>,
  ) {}

  async findAll(page: number, limit: number, search: string) {
    const query = this.countryRepository.createQueryBuilder('country');

    if (search) {
      query.where(
        'country.erpnext ILIKE :search OR country.code ILIKE :search OR country.amazon ILIKE :search OR country.flipkart ILIKE :search',
        { search: `%${search}%` }
      );
    }

    query.orderBy('country.updatedAt', 'DESC');
    query.addOrderBy('country.erpnext', 'ASC');
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
    const country = await this.countryRepository.findOne({ where: { id } });
    if (!country) throw new NotFoundException(`Country with ID ${id} not found`);
    return country;
  }

  async create(dto: CreateCountryDto) {
    const country = this.countryRepository.create(dto);
    return this.countryRepository.save(country);
  }

  async update(id: string, dto: UpdateCountryDto) {
    const country = await this.findOne(id);
    this.countryRepository.merge(country, dto);
    return this.countryRepository.save(country);
  }

  async remove(id: string) {
    const country = await this.findOne(id);
    return this.countryRepository.remove(country);
  }
}
