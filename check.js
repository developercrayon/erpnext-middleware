const {Client}=require('pg');
const c=new Client({connectionString:'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix'});
c.connect().then(async()=>{
  const r=await c.query("SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 5");
  console.log(r.rows);
  c.end()
});
