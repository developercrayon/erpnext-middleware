const { Client } = require('pg'); 
const c = new Client('postgres://postgres:postgres@194.163.134.149:3455/inkreatix'); 
c.connect().then(() => c.query(`SELECT * FROM erpnext_amazon_mappings`).then(res => { 
  console.log(res.rows); 
  c.end(); 
}))
