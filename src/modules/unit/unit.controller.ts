import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { UnitService } from './unit.service';
import { CreateUnitDto, UpdateUnitDto } from './dto/unit.dto';

@Controller('unit')
export class UnitController {
  constructor(private readonly unitService: UnitService) {}

  @Get()
  async findAll(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('search') search: string = '',
  ) {
    return this.unitService.findAll(Number(page), Number(limit), search);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.unitService.findOne(id);
  }

  @Post()
  async create(@Body() createUnitDto: CreateUnitDto) {
    return this.unitService.create(createUnitDto);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() updateUnitDto: UpdateUnitDto) {
    return this.unitService.update(id, updateUnitDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.unitService.remove(id);
  }
}
