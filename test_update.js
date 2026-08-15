const axios = require('axios');
require('dotenv').config();

async function run() {
  try {
    const listRes = await axios.get(`${process.env.ERPNEXT_BASE_URL}/api/method/paginateditem?limit_page_length=1`, {
      headers: { Authorization: `token ${process.env.ERPNEXT_API_KEY}:${process.env.ERPNEXT_API_SECRET}` }
    });
    const sku = listRes.data.message.items[0].item_code;
    console.log("Testing SKU:", sku);

    const res = await axios.put(`${process.env.ERPNEXT_BASE_URL}/api/resource/Item/${encodeURIComponent(sku)}`, {
      custom_amazon: 1
    }, {
      headers: { Authorization: `token ${process.env.ERPNEXT_API_KEY}:${process.env.ERPNEXT_API_SECRET}` }
    });
    console.log("updateItem success");
  } catch (err) {
    console.log("updateItem error:", err.response ? JSON.stringify(err.response.data) : err.message);
  }
}
run();
