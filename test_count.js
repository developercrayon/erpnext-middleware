const axios = require('axios');
(async () => {
  try {
    const url = 'https://woodwolf.t3elements.com/api/resource/Item?fields=["name"]&limit_page_length=0';
    const res = await axios.get(url, {
      headers: {
        'Authorization': 'token 8bbb46d32ae70f1:9d7f375b7aa08fa',
        'Content-Type': 'application/json'
      }
    });
    console.log('SUCCESS COUNT:', res.data.data.length);
  } catch(e) {
    console.log('ERROR:', e.message);
  }
})();
