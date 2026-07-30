import { Controller, Get, Post, Body, Put, Param, Delete, Query } from '@nestjs/common';
import { CountryService } from './country.service';
import { CreateCountryDto, UpdateCountryDto } from './dto/country.dto';

@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  async findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('search') search: string = '',
  ) {
    return this.countryService.findAll(Number(page), Number(limit), search);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.countryService.findOne(id);
  }

  @Post()
  create(@Body() createCountryDto: CreateCountryDto) {
    return this.countryService.create(createCountryDto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() updateCountryDto: UpdateCountryDto) {
    return this.countryService.update(id, updateCountryDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.countryService.remove(id);
  }
}
