require('dotenv').config();
const axios = require('axios');

async function run() {
  try {
    // Auth
    const authRes = await axios.post('https://api.amazon.com/auth/o2/token', new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.AMAZON_REFRESH_TOKEN,
      client_id: process.env.AMAZON_CLIENT_ID,
      client_secret: process.env.AMAZON_CLIENT_SECRET,
    }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    
    const token = authRes.data.access_token;
    
    // Get product types
    const res = await axios.get(`${process.env.AMAZON_ENDPOINT}/definitions/2020-09-01/productTypes`, {
      headers: {
        'x-amz-access-token': token,
      },
      params: {
        marketplaceIds: process.env.AMAZON_MARKETPLACE_ID,
      }
    });

    const types = res.data.productTypes;
    const mugTypes = types.filter(t => t.name.toLowerCase().includes('mug') || t.name.toLowerCase().includes('cup') || t.name.toLowerCase().includes('drink') || t.name.toLowerCase().includes('kitchen') || t.name.toLowerCase().includes('home'));
    
    console.log("Found Types:", mugTypes.map(t => t.name));

  } catch(e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
run();
