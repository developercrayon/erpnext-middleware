/**
 * Maps the frontend product form payload to an ERPNext-compatible Item payload.
 *
 * Key responsibilities:
 *  - Inject `doctype` into every child table row (Table / Table MultiSelect fields)
 *    using the `options` value from the field schema (erpnext_product_field table).
 *  - Convert comma-separated tags string → ERPNext item_tags child table format.
 *  - Map the thumbnail URL to ERPNext's native `image` field.
 *  - Strip internal UI-only fields (_pending_*, _attachments, etc.)
 */
export function mapFrontendToERPNext(
  data: any,
  /** Pass the full Item schema so we can resolve child doctypes by fieldname */
  schema: Array<{ fieldname: string; fieldtype: string; options?: string }> = [],
): Record<string, any> {
  // Build a quick lookup: fieldname → options (child doctype name)
  const fieldMeta: Record<string, { fieldtype: string; options?: string }> = {};
  for (const f of schema) {
    if (f.fieldname) fieldMeta[f.fieldname] = { fieldtype: f.fieldtype, options: f.options };
  }

  const TABLE_TYPES = new Set(['Table', 'Table MultiSelect']);

  const payload: Record<string, any> = {};

  // ── Strip internal keys ───────────────────────────────────────────────────
  const SKIP_KEYS = new Set([
    '_attachments', '_pending_files', '_pending_thumbnail_file',
    '_ai_images', '_pending_variants', '_uploaded_images', 'productType',
  ]);

  for (const [key, value] of Object.entries(data)) {
    if (SKIP_KEYS.has(key)) continue;
    if (value === undefined || value === null) continue;

    const meta = fieldMeta[key];

    // ── Child table fields — inject doctype into every row ─────────────────
    if (meta && TABLE_TYPES.has(meta.fieldtype) && Array.isArray(value)) {
      const childDoctype = meta.options?.trim();
      payload[key] = value.map((row: any) => {
        if (typeof row !== 'object') return row;
        // Merge doctype in; let existing doctype on the row win if already set
        return childDoctype
          ? { doctype: childDoctype, ...row }
          : row;
      });
      continue;
    }

    // ── Tags field — convert "tag1, tag2" → [{doctype, tag}] ──────────────
    if (key === 'item_tags' || key === 'custom_tags' || key === 'tags') {
      if (typeof value === 'string' && value.trim()) {
        const tagList = value.split(',').map((t: string) => t.trim()).filter(Boolean);
        payload['item_tags'] = tagList.map((tag: string) => ({
          doctype: 'Item Tag',
          tag,
        }));
      } else if (Array.isArray(value) && value.length > 0) {
        // Already an array (e.g., from edit mode)
        payload['item_tags'] = value.map((t: any) =>
          typeof t === 'string' ? { doctype: 'Item Tag', tag: t } : t
        );
      }
      continue;
    }

    // ── Thumbnail → ERPNext native `image` field ───────────────────────────
    if (key === 'custom_thumbnail_image') {
      if (value) {
        payload['image'] = value;   // ERPNext uses `image` for the item thumbnail
        payload[key] = value;       // also keep the custom field
      }
      continue;
    }

    payload[key] = value;
  }

  // ── Legacy camelCase field overrides (kept for backwards compat) ──────────
  if (data.itemCode   && !payload.item_code)   payload.item_code   = data.itemCode;
  if (data.itemName   && !payload.item_name)   payload.item_name   = data.itemName;
  if (data.itemGroup  && !payload.item_group)  payload.item_group  = data.itemGroup;
  if (data.hsnCode    && !payload.gst_hsn_code) payload.gst_hsn_code = data.hsnCode;
  if (data.countryOfOrigin && !payload.country_of_origin) payload.country_of_origin = data.countryOfOrigin;
  if (data.brand      && !payload.brand)       payload.brand       = data.brand;
  if (data.mrp        && !payload.custom_mrp)  payload.custom_mrp  = data.mrp;
  if (data.sellingPrice && !payload.standard_rate) payload.standard_rate = data.sellingPrice;
  if (data.valuationRate && !payload.valuation_rate) payload.valuation_rate = data.valuationRate;
  if (data.weight     && !payload.weight_per_unit) payload.weight_per_unit = data.weight;
  if (data.weightUnit && !payload.weight_uom)  payload.weight_uom  = data.weightUnit;

  // Boolean coercions
  if ('disabled' in data) payload.disabled = data.disabled ? 1 : 0;
  if (data.maintainStock !== undefined) payload.is_stock_item = data.maintainStock ? 1 : 0;
  if (data.allowAlternativeItem !== undefined) payload.allow_alternative_item = data.allowAlternativeItem ? 1 : 0;
  if (data.isFixedAsset !== undefined) payload.is_fixed_asset = data.isFixedAsset ? 1 : 0;

  // ERPNext defaults
  if (!payload.item_group) payload.item_group = 'Products';
  if (!payload.stock_uom) payload.stock_uom = 'Nos';
  if (!('is_stock_item' in payload)) payload.is_stock_item = 1;

  // Remove any remaining undefined / null
  Object.keys(payload).forEach(k => {
    if (payload[k] === undefined || payload[k] === null) delete payload[k];
  });

  return payload;
}
