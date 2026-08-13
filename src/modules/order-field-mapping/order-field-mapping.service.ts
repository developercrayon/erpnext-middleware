import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderFieldMapping } from '../../database/entities/order-field-mapping.entity';
import { MarketplaceSource } from '../../database/entities/order.entity';

@Injectable()
export class OrderFieldMappingService {
  constructor(
    @InjectRepository(OrderFieldMapping)
    private repository: Repository<OrderFieldMapping>,
  ) {}

  async findAll(marketplace?: MarketplaceSource): Promise<OrderFieldMapping[]> {
    const query = this.repository.createQueryBuilder('mapping');
    if (marketplace) {
      query.andWhere('mapping.marketplace = :marketplace', { marketplace });
    }
    return query.getMany();
  }

  async bulkSave(mappings: Partial<OrderFieldMapping>[], marketplace: MarketplaceSource): Promise<OrderFieldMapping[]> {
    // We only keep the new mappings for this marketplace, so we can delete all existing for it
    // and re-insert. But wait, the user instructions say "Add delete icon in each row to remove that specifi row of bindings".
    // "when delete remove that record & at then end add SAVE button which is save all records"
    // So the UI will just send the array of mappings. A full replace for that marketplace is the easiest and safest way.
    
    await this.repository.delete({ marketplace });
    
    if (mappings && mappings.length > 0) {
      const toSave = mappings.map(m => this.repository.create({
        ...m,
        marketplace,
      }));
      return this.repository.save(toSave);
    }
    
    return [];
  }
}
