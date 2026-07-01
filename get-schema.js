require('dotenv').config();
const axios = require('axios');
const fs = require('fs');

async function run() {
  try {
    const authRes = await axios.post('https://api.amazon.com/auth/o2/token', new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.AMAZON_REFRESH_TOKEN,
      client_id: process.env.AMAZON_CLIENT_ID,
      client_secret: process.env.AMAZON_CLIENT_SECRET,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    
    const token = authRes.data.access_token;
    
    const res = await axios.get(`${process.env.AMAZON_ENDPOINT}/definitions/2020-09-01/productTypes/DRINKING_CUP`, {
      headers: {
        'x-amz-access-token': token,
      },
      params: {
        marketplaceIds: process.env.AMAZON_MARKETPLACE_ID,
        requirements: 'LISTING'
      }
    });

    fs.writeFileSync('schema.json', JSON.stringify(res.data, null, 2));
    console.log("Schema saved to schema.json");

  } catch(e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
run();
