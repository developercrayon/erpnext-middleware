export function mapFrontendToERPNext(data: any): Record<string, any> {
  const payload: Record<string, any> = {
    item_code: data.itemCode,
    item_name: data.itemName,
    item_group: data.itemGroup,
    gst_hsn_code: data.hsnCode,
    country_of_origin: data.countryOfOrigin,
    brand: data.brand,
    disabled: data.disabled ? 1 : 0,
    is_stock_item: data.maintainStock ? 1 : 0,
    allow_alternative_item: data.allowAlternativeItem ? 1 : 0,
    is_fixed_asset: data.isFixedAsset ? 1 : 0,
    description: data.description,
    custom_mrp: data.mrp,
    standard_rate: data.sellingPrice,
    valuation_rate: data.valuationRate,
    custom_amazon_price: data.amazonPrice,
    custom_flipkart_price: data.flipkartPrice,
    custom_amazon: data.enableAmazon ? 1 : 0,
    custom_flipkart: data.enableFlipkart ? 1 : 0,
    custom_amazon_product_type: data.amazonProductType,
    custom_amazon_item_type_name: data.amazonItemTypeName,
    custom_amazon_model_name: data.amazonModelName,
    custom_amazon_style: data.amazonStyle,
    custom_amazon_number_of_items: data.amazonNumberOfItems,
    custom_amazon_color: data.amazonColor,
    custom_amazon_number_of_pieces: data.amazonNumberOfPieces,
    custom_amazon_item_shape: data.amazonItemShape,
    custom_amazon_shelf_type: data.amazonShelfType,
    custom_amazon_number_of_shelves: data.amazonNumberOfShelves,
    weight_per_unit: data.weight,
    weight_uom: data.weightUnit,
    has_variants: data.productType === 'MASTER' ? 1 : 0,
    variant_of: data.variantOf,
  };

  // Remove undefined fields
  Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

  return payload;
}
