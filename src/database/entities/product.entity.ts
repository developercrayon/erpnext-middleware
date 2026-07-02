import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ProductStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  DRAFT = 'DRAFT',
  DISCONTINUED = 'DISCONTINUED',
}

@Entity('products')
@Index(['sku'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sku', type: 'varchar', unique: true })
  sku: string;

  @Column({ name: 'erpnext_item_code', type: 'varchar', nullable: true })
  erpnextItemCode: string;

  @Column({ name: 'amazon_asin', type: 'varchar', nullable: true })
  amazonAsin: string;

  @Column({ name: 'amazon_fnsku', type: 'varchar', nullable: true })
  amazonFnsku: string;

  @Column({ name: 'amazon_product_type', type: 'varchar', nullable: true })
  amazonProductType: string;

  @Column({ name: 'upc', type: 'varchar', nullable: true })
  upc: string;

  @Column({ name: 'flipkart_sku', type: 'varchar', nullable: true })
  flipkartSku: string;

  @Column({ name: 'thumbnail_url', type: 'text', nullable: true })
  thumbnailUrl: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string;

  @Column({ name: 'category', type: 'varchar', nullable: true })
  category: string;

  @Column({ name: 'brand', type: 'varchar', nullable: true })
  brand: string;

  @Column({ name: 'uom', type: 'varchar', default: 'Nos' })
  uom: string;

  @Column({ name: 'hsn_code', type: 'varchar', nullable: true })
  hsnCode: string;

  @Column({ name: 'gst_rate', type: 'decimal', precision: 5, scale: 2, default: 18 })
  gstRate: number;

  @Column({ name: 'mrp', type: 'decimal', precision: 12, scale: 2, default: 0 })
  mrp: number;

  @Column({ name: 'selling_price', type: 'decimal', precision: 12, scale: 2, default: 0 })
  sellingPrice: number;

  @Column({ name: 'cost_price', type: 'decimal', precision: 12, scale: 2, default: 0 })
  costPrice: number;

  @Column({ name: 'weight', type: 'decimal', precision: 8, scale: 3, nullable: true })
  weight: number;

  @Column({ name: 'weight_uom', type: 'varchar', default: 'Kg' })
  weightUom: string;

  @Column({ name: 'images', type: 'jsonb', nullable: true })
  images: string[];

  @Column({ name: 'attributes', type: 'jsonb', nullable: true })
  attributes: Record<string, any>;

  @Column({ name: 'custom_amazon_price', type: 'decimal', precision: 12, scale: 2, nullable: true })
  customAmazonPrice: number;

  @Column({ name: 'custom_flipkart_price', type: 'decimal', precision: 12, scale: 2, nullable: true })
  customFlipkartPrice: number;

  @Column({ name: 'custom_amazon', type: 'boolean', default: false })
  customAmazon: boolean;

  @Column({ name: 'custom_flipkart', type: 'boolean', default: false })
  customFlipkart: boolean;

  @Column({ name: 'status', type: 'enum', enum: ProductStatus, default: ProductStatus.ACTIVE })
  status: ProductStatus;

  @Column({ name: 'is_parent', type: 'boolean', default: false })
  isParent: boolean;

  @Column({ name: 'variant_of', type: 'varchar', nullable: true })
  variantOf: string;

  @Column({ name: 'variation_theme', type: 'varchar', nullable: true })
  variationTheme: string;

  @Column({ name: 'variant_attributes', type: 'jsonb', nullable: true })
  variantAttributes: { name: string; value: string }[];

  @Column({ name: 'is_amazon_listed', type: 'boolean', default: false })
  isAmazonListed: boolean;

  @Column({ name: 'is_flipkart_listed', type: 'boolean', default: false })
  isFlipkartListed: boolean;

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
