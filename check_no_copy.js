require('dotenv').config();
const axios = require('axios');
const token = 'token ' + process.env.ERPNEXT_API_KEY + ':' + process.env.ERPNEXT_API_SECRET;

axios.get('https://woodwolf.t3elements.com/api/resource/Custom Field?limit_page_length=2000', {headers:{Authorization: token}})
  .then(r => {
    const fields = r.data.data;
    const f = fields.find(x => x.name.includes('custom_item_width'));
    if (!f) return console.log('Field not found');
    return axios.get('https://woodwolf.t3elements.com/api/resource/Custom Field/' + f.name, {headers:{Authorization: token}});
  })
  .then(r => {
    if(r) console.log('no_copy for custom_item_width:', r.data.data.no_copy);
  })
  .catch(e => console.log(e.message));
