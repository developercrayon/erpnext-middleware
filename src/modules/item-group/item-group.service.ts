import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ItemGroupConfig, ItemGroupPrompt } from '../../database/entities/item-group.entity';
import { ERPNextConnector } from '../connectors/erpnext/erpnext.connector';

@Injectable()
export class ItemGroupService {
  private readonly logger = new Logger(ItemGroupService.name);

  constructor(
    @InjectRepository(ItemGroupConfig)
    private readonly configRepo: Repository<ItemGroupConfig>,
    @InjectRepository(ItemGroupPrompt)
    private readonly promptRepo: Repository<ItemGroupPrompt>,
    private readonly erpnextConnector: ERPNextConnector,
  ) {}

  async fetchFromERPNext(params: { limit_start?: number; limit_page_length?: number; search?: string }) {
    const result = await this.erpnextConnector.fetchItemGroups(params);
    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch item groups from ERPNext');
    }
    const extractedData = (result.data as any)?.data;
    const items = Array.isArray(extractedData) ? extractedData : [];
    const totalCount = (result.data as any)?.total || 0;

    // Fetch local configs to see which ones have amazon product type mapping
    const names = items.map((i: any) => i.name);
    let configs: ItemGroupConfig[] = [];
    if (names.length > 0) {
      configs = await this.configRepo.createQueryBuilder('c')
        .where('c.itemGroup IN (:...names)', { names })
        .getMany();
    }

    const configMap = new Map<string, ItemGroupConfig>();
    for (const c of configs) configMap.set(c.itemGroup, c);

    return {
      data: items.map((item: any) => ({
        ...item,
        amazonProductType: configMap.get(item.name)?.amazonProductType || null,
      })),
      total: totalCount,
    };
  }

  async getConfig(itemGroup: string) {
    let config = await this.configRepo.findOne({
      where: { itemGroup },
      relations: ['imagePrompts'],
    });

    if (!config) {
      // Return a default structure if not configured yet
      config = this.configRepo.create({
        itemGroup,
        amazonProductType: null,
        imagePrompts: [],
      });
    }

    // Sort prompts by sortOrder
    if (config.imagePrompts) {
      config.imagePrompts.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    return config;
  }

  async saveConfig(itemGroup: string, data: { amazonProductType?: string, imagePrompts?: any[] }) {
    let config = await this.configRepo.findOne({
      where: { itemGroup },
      relations: ['imagePrompts'],
    });

    if (!config) {
      config = this.configRepo.create({ itemGroup });
    }

    if (data.amazonProductType !== undefined) {
      config.amazonProductType = data.amazonProductType;
    }

    if (data.imagePrompts) {
      // Remove old prompts
      if (config.imagePrompts && config.imagePrompts.length > 0) {
        await this.promptRepo.remove(config.imagePrompts);
      }
      
      // Add new prompts
      config.imagePrompts = data.imagePrompts.map((p, idx) => {
        return this.promptRepo.create({
          itemGroup: itemGroup,
          promptText: p.promptText,
          sortOrder: typeof p.sortOrder === 'number' ? p.sortOrder : idx,
          isEnabled: p.isEnabled !== undefined ? p.isEnabled : true,
        });
      });
    }

    return await this.configRepo.save(config);
  }
}
