const axios = require('axios');
const url = 'https://woodwolf.t3elements.com/api/resource/Item?limit_page_length=1&fields=["*"]';
axios.get(url, {
  headers: {
    'Authorization': 'token 8bbb46d32ae70f1:9d7f375b7aa08fa',
    'Content-Type': 'application/json'
  }
}).then(res => console.log('SUCCESS:', Object.keys(res.data.data[0]).filter(k => k.includes('item') || k.includes('sku') || k.includes('name')))).catch(err => console.log('ERROR:', err.message));
