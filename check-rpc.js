const axios = require('axios');
axios.post('https://woodwolf.t3elements.com/api/method/frappe.client.get_list', {
  doctype: 'Item Barcode',
  fields: ['barcode', 'barcode_type', 'parent']
}, {
  headers: { Authorization: 'token ddc77c76e8b9939:6dc3324d15a08b7' }
}).then(r => {
  console.log(JSON.stringify(r.data, null, 2));
}).catch(e => console.log(e.response ? e.response.data : e.message));
