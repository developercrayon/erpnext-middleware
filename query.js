const { Client } = require('pg');
const c = new Client('postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix');
c.connect().then(() => {
  return c.query("SELECT * FROM field_mappings");
}).then(res => {
  console.log(JSON.stringify(res.rows, null, 2));
  c.end();
}).catch(err => {
  console.error(err);
  c.end();
});
