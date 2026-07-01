const axios = require('axios');
axios.get('https://woodwolf.t3elements.com/api/resource/Item Barcode?filters=[["parent","=","Woodwolf® Ceramic Coffee Mug Test"]]&fields=["*"]', {
  headers: { Authorization: 'token ddc77c76e8b9939:6dc3324d15a08b7' }
}).then(r => {
  console.log(JSON.stringify(r.data.data, null, 2));
}).catch(e => console.log(e.response ? e.response.data : e.message));
