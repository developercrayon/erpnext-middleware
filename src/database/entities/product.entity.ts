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

  @Column({ name: 'custom_item_type_name', type: 'varchar', nullable: true })
  customItemTypeName: string;

  @Column({ name: 'custom_model_name', type: 'varchar', nullable: true })
  customModelName: string;

  @Column({ name: 'custom_style', type: 'varchar', nullable: true })
  customStyle: string;

  @Column({ name: 'custom_number_of_items', type: 'int', nullable: true })
  customNumberOfItems: number;

  @Column({ name: 'custom_color', type: 'varchar', nullable: true })
  customColor: string;

  @Column({ name: 'custom_number_of_pieces', type: 'int', nullable: true })
  customNumberOfPieces: number;

  @Column({ name: 'custom_model_number', type: 'varchar', nullable: true })
  customModelNumber: string;

  @Column({ name: 'custom_manufacturer_contact_info', type: 'varchar', nullable: true })
  customManufacturerContactInfo: string;

  @Column({ name: 'custom_required_assembly', type: 'boolean', nullable: true })
  customRequiredAssembly: boolean;

  @Column({ name: 'custom_depth', type: 'decimal', precision: 8, scale: 2, nullable: true })
  customDepth: number;

  @Column({ name: 'custom_width', type: 'decimal', precision: 8, scale: 2, nullable: true })
  customWidth: number;

  @Column({ name: 'custom_height', type: 'decimal', precision: 8, scale: 2, nullable: true })
  customHeight: number;

  @Column({ name: 'custom_number_of_packs', type: 'decimal', precision: 8, scale: 2, nullable: true })
  customNumberOfPacks: number;

  @Column({ name: 'custom_external_product_information', type: 'varchar', nullable: true })
  customExternalProductInformation: string;

  @Column({ name: 'custom_shelf_thickness', type: 'decimal', precision: 8, scale: 2, nullable: true })
  customShelfThickness: number;

  @Column({ name: 'custom_assembly_instructions', type: 'varchar', nullable: true })
  customAssemblyInstructions: string;

  @Column({ name: 'custom_unit', type: 'varchar', nullable: true })
  customUnit: string;

  @Column({ name: 'custom_item_shape', type: 'varchar', nullable: true })
  customItemShape: string;

  @Column({ name: 'custom_shelf_type', type: 'varchar', nullable: true })
  customShelfType: string;

  @Column({ name: 'custom_number_of_shelves', type: 'int', nullable: true })
  customNumberOfShelves: number;

  @Column({ name: 'custom_mounting_type', type: 'varchar', nullable: true })
  customMountingType: string;

  @Column({ name: 'custom_finish_type', type: 'varchar', nullable: true })
  customFinishType: string;

  @Column({ name: 'custom_select_material', type: 'jsonb', nullable: true })
  customSelectMaterial: any;

  @Column({ name: 'custom_included_components', type: 'jsonb', nullable: true })
  customIncludedComponents: any;

  @Column({ name: 'custom_amazon_bullet_point', type: 'jsonb', nullable: true })
  customAmazonBulletPoint: any;

  @Column({ name: 'custom_packer_contact_information', type: 'jsonb', nullable: true })
  customPackerContactInformation: any;

  @Column({ name: 'custom_specific_uses_for_product', type: 'jsonb', nullable: true })
  customSpecificUsesForProduct: any;

  @Column({ name: 'custom_recommended_uses_for_product', type: 'jsonb', nullable: true })
  customRecommendedUsesForProduct: any;

  @Column({ name: 'custom_room_type', type: 'jsonb', nullable: true })
  customRoomType: any;

  @Column({ name: 'custom_special_feature', type: 'jsonb', nullable: true })
  customSpecialFeature: any;

  @Column({ name: 'custom_care_instructions', type: 'jsonb', nullable: true })
  customCareInstructions: any;

  @Column({ name: 'available_qty', type: 'decimal', precision: 12, scale: 3, default: 0 })
  availableQty: number;

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
