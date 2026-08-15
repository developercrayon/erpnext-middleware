const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix' });
async function run() {
  await client.connect();
  const res = await client.query("SELECT * FROM error_logs_v2 ORDER BY \"created_at\" DESC LIMIT 3;");
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run().catch(console.error);
