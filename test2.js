const axios = require('axios');
async function run() {
  try {
    const filters = encodeURIComponent('[["parent","in",["Item Package Dimensions", "Item Dimensions", "Item Weight", "Package Weight", "Item Dimension dxwxh", "Amazon Item Dimension", "Amazon Package Dimension"]]]');
    const res = await axios.get('https://woodwolf.t3elements.com/api/resource/DocField?filters=' + filters + '&limit=100&fields=["parent","fieldname","fieldtype"]', {
      headers: { Authorization: 'token 8bbb46d32ae70f1:9d7f375b7aa08fa' }
    });
    
    const fieldsByParent = {};
    for (const f of res.data.data) {
      if (!fieldsByParent[f.parent]) fieldsByParent[f.parent] = [];
      fieldsByParent[f.parent].push(f);
    }
    
    for (const parent in fieldsByParent) {
      console.log('---', parent, '---');
      for (const f of fieldsByParent[parent]) {
         if (f.fieldtype !== 'Section Break' && f.fieldtype !== 'Column Break') {
           console.log(f.fieldname, '(', f.fieldtype, ')');
         }
      }
    }
  } catch(e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
run();
