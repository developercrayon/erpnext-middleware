require('dotenv').config();
const axios = require('axios');
const token = 'token ' + process.env.ERPNEXT_API_KEY + ':' + process.env.ERPNEXT_API_SECRET;
axios.get('https://woodwolf.t3elements.com/api/resource/Item?fields=["item_code"]&limit_page_length=1000', {headers:{Authorization: token}}).then(r => {
  const erpItems = r.data.data.map(d=>d.item_code);
  const fs = require('fs');
  const lines = fs.readFileSync('logs/app-2026-07-17.log.1', 'utf8').split('\n');
  const allSkus = [...new Set(lines.map(l => {
    const m = l.match(/Item ([A-Z0-9]+) does not exist in ERPNext/);
    return m ? m[1] : null;
  }).filter(Boolean))];
  const missing = allSkus.filter(s => !erpItems.includes(s));
  console.log('Missing SKUs:', missing);
  missing.forEach(sku => {
    console.log('--- Errors for', sku, '---');
    const errs = fs.readFileSync('logs/error-2026-07-17.log', 'utf8').split('\n').filter(l => l.includes(sku) && l.includes('Failed to push'));
    console.log(errs.join('\n'));
  });
}).catch(e=>console.log(e.message));
