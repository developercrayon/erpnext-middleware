import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { ErpnextAttribute } from '../../database/entities/erpnext-attribute.entity';
import { ERPNextConnector } from '../connectors/erpnext/erpnext.connector';

@Injectable()
export class ErpnextAttributesService {
  private readonly logger = new Logger(ErpnextAttributesService.name);

  constructor(
    @InjectRepository(ErpnextAttribute)
    private readonly repo: Repository<ErpnextAttribute>,
    private readonly erpnextConnector: ERPNextConnector,
  ) {}

  async findAll(page: number = 1, limit: number = 50, search?: string) {
    const whereCondition = search ? { name: ILike(`%${search}%`) } : {};
    const [data, total] = await this.repo.findAndCount({
      where: whereCondition,
      skip: (page - 1) * limit,
      take: limit,
      order: { name: 'ASC' },
    });
    return { data, total, page, limit };
  }

  async syncAttributes() {
    this.logger.log('Starting sync of ERPNext Attributes');
    const result = await this.erpnextConnector.fetchItemAttributes();
    
    // Support both standard resource format (data) and method format (message)
    const attributes = result.data?.message || result.data?.data;

    if (!result.success || !attributes) {
      throw new Error(`Failed to fetch attributes from ERPNext: ${result.error}`);
    }

    let savedCount = 0;

    for (const attr of attributes) {
      try {
        let existing = await this.repo.findOne({ where: { name: attr.name } });
        const attrValues = attr.values || attr.item_attribute_values || [];
        if (existing) {
          existing.item_attribute_values = attrValues;
          await this.repo.save(existing);
        } else {
          const newAttr = this.repo.create({
            name: attr.name,
            item_attribute_values: attrValues,
          });
          await this.repo.save(newAttr);
        }
        savedCount++;
      } catch (err: any) {
        this.logger.error(`Error saving attribute ${attr.name}: ${err.message}`);
      }
    }

    this.logger.log(`Successfully synced ${savedCount} attributes`);
    return { success: true, message: `Synced ${savedCount} attributes from ERPNext` };
  }
}
