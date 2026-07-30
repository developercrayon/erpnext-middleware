const axios = require('axios');
async function run() {
  try {
    const filters = encodeURIComponent('[["parent","=","Item"],["fieldname","in",["custom_item_dimension_dxwxh","custom_item_weight","custom_package_weight","custom_item_dimensions","custom_package_dimensions"]]]');
    const res = await axios.get('https://woodwolf.t3elements.com/api/resource/DocField?filters=' + filters + '&limit=10&fields=["fieldname","options"]', {
      headers: { Authorization: 'token 8bbb46d32ae70f1:9d7f375b7aa08fa' }
    });
    const fields = res.data.data;
    for (const f of fields) {
      console.log(f.fieldname, '->', f.options);
      if (f.options) {
         const s = await axios.get('https://woodwolf.t3elements.com/api/resource/DocType/' + encodeURIComponent(f.options), {
           headers: { Authorization: 'token 8bbb46d32ae70f1:9d7f375b7aa08fa' }
         });
         console.log('  Fields for', f.options, ':');
         s.data.data.fields.forEach(cf => {
           if(cf.fieldtype !== 'Section Break' && cf.fieldtype !== 'Column Break') {
             console.log('    ', cf.fieldname, cf.fieldtype);
           }
         });
      }
    }
  } catch(e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
run();
