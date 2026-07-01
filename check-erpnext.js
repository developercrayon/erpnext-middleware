const axios = require('axios');
axios.get('https://woodwolf.t3elements.com/api/resource/Item/Woodwolf® Ceramic Coffee Mug Test', {
  headers: { Authorization: 'token ddc77c76e8b9939:6dc3324d15a08b7' }
}).then(r => {
  console.log("Custom Amazon Product Type:", r.data.data.custom_amazon_product_type);
}).catch(e => console.log(e.response ? e.response.data : e.message));
