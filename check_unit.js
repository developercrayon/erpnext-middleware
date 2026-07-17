require('dotenv').config();
const axios = require('axios');
const token = 'token ' + process.env.ERPNEXT_API_KEY + ':' + process.env.ERPNEXT_API_SECRET;

axios.get('https://woodwolf.t3elements.com/api/resource/Custom Field?limit_page_length=2000', {headers:{Authorization: token}})
  .then(r => {
    const fields = r.data.data;
    const targets = ['custom_item_weight_unit', 'custom_weight_unit', 'custom_lwh_unit', 'custom_item_lwh_unit'];
    return Promise.all(targets.map(t => {
      const f = fields.find(x => x.name.includes(t));
      if (!f) return null;
      return axios.get('https://woodwolf.t3elements.com/api/resource/Custom Field/' + f.name, {headers:{Authorization: token}});
    }));
  })
  .then(results => {
    results.forEach((r, i) => {
      if (r) {
        console.log(r.data.data.fieldname, '->', r.data.data.fieldtype, r.data.data.options);
      }
    });
  })
  .catch(e => console.log(e.message));
