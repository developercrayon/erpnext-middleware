import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, JoinColumn, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';

@Entity('item_group_config')
export class ItemGroupConfig {
  @PrimaryColumn({ name: 'item_group', type: 'varchar' })
  itemGroup: string;

  @Column({ name: 'amazon_product_type', type: 'varchar', nullable: true })
  amazonProductType: string;

  @OneToMany(() => ItemGroupPrompt, (prompt) => prompt.itemGroupConfig, { cascade: true })
  imagePrompts: ItemGroupPrompt[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('item_group_prompts')
export class ItemGroupPrompt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ItemGroupConfig, (c) => c.imagePrompts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_group' })
  itemGroupConfig: ItemGroupConfig;

  @Column({ name: 'item_group', type: 'varchar' })
  itemGroup: string;

  @Column({ name: 'prompt_text', type: 'text' })
  promptText: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
