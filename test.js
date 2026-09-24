const axios = require('axios');
async function test() {
  try {
    const res = await axios.get('https://woodwolf.t3elements.com/api/resource/File?fields=[\"name\",\"file_url\",\"is_private\"]&limit_page_length=5', {
      headers: {
        'Authorization': 'token 8bbb46d32ae70f1:9d7f375b7aa08fa'
      }
    });
    console.log(res.data);
  } catch(e) {
    console.log(e.response?.data || e.message);
  }
}
test();
