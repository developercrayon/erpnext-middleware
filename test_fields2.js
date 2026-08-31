const axios = require('axios');
const url = 'https://woodwolf.t3elements.com/api/resource/Item?limit_page_length=2&fields=["*"]';
axios.get(url, {
  headers: {
    'Authorization': 'token 8bbb46d32ae70f1:9d7f375b7aa08fa',
    'Content-Type': 'application/json'
  }
}).then(res => console.log('SUCCESS:', res.data.data.map(i => ({ name: i.name, item_code: i.item_code })))).catch(err => console.log('ERROR:', err.message));
