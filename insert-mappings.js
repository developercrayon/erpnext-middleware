const { Client } = require('pg');
const { v4: uuidv4 } = require('uuid');

async function run() {
  const client = new Client({ connectionString: 'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix' });
  await client.connect();

  const missingMappings = [
    { erpnext_field: 'custom_select_material', marketplace_field: 'material', product_type: 'TRAY' },
    { erpnext_field: 'custom_style', marketplace_field: 'style', product_type: 'TRAY' },
    { erpnext_field: 'custom_recommended_uses_for_product', marketplace_field: 'recommended_uses_for_product', product_type: 'TRAY' },
    { erpnext_field: 'weight', marketplace_field: 'item_weight', product_type: 'TRAY' }
  ];

  try {
    for (const m of missingMappings) {
      // Check if it already exists
      const check = await client.query('SELECT 1 FROM field_mappings WHERE product_type = $1 AND marketplace_field = $2', [m.product_type, m.marketplace_field]);
      if (check.rows.length === 0) {
        await client.query(`
          INSERT INTO field_mappings (id, marketplace, product_type, erpnext_field, marketplace_field, data_type, use_default, created_at, updated_at)
          VALUES ($1, 'AMAZON', $2, $3, $4, 'STRING', false, NOW(), NOW())
        `, [uuidv4(), m.product_type, m.erpnext_field, m.marketplace_field]);
        console.log(`Inserted mapping: ${m.marketplace_field} -> ${m.erpnext_field}`);
      } else {
        console.log(`Mapping already exists: ${m.marketplace_field}`);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run().catch(console.error);
