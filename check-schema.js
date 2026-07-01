const {Client}=require('pg');
const c=new Client({connectionString:'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix'});
c.connect().then(async()=>{
  const r=await c.query("SELECT current_setting('TIMEZONE') as tz, now() as pg_now");
  console.log(r.rows);
  c.end()
});
