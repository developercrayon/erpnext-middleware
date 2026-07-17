require('dotenv').config();
const axios = require('axios');
const token = 'token ' + process.env.ERPNEXT_API_KEY + ':' + process.env.ERPNEXT_API_SECRET;

axios.get('https://woodwolf.t3elements.com/api/resource/UOM?limit_page_length=2000', {headers:{Authorization: token}})
  .then(r => {
    const uoms = r.data.data.map(u => u.name);
    console.log("mm match:", uoms.filter(u => u.toLowerCase().includes('millimeter')));
    console.log("lb match:", uoms.filter(u => u.toLowerCase().includes('pound')));
  })
  .catch(e => console.log(e.message));
