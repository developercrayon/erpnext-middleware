const axios = require('axios');
require('dotenv').config();

async function run() {
  try {
    const res = await axios.get(`${process.env.ERPNEXT_BASE_URL}/api/method/paginateditem`, {
      headers: {
        Authorization: `token ${process.env.ERPNEXT_API_KEY}:${process.env.ERPNEXT_API_SECRET}`
      }
    });
    console.log("paginateditem success");
  } catch (err) {
    console.log("paginateditem error:", err.response ? err.response.data : err.message);
  }
}
run();
