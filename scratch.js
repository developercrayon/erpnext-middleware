const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: 'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix' });
  await client.connect();
  const res = await client.query("SELECT request_body FROM api_logs WHERE request_body::text LIKE '%FB-087Q-G767%' AND url LIKE '%/api/resource/Item%' ORDER BY id DESC LIMIT 1");
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run().catch(console.error);
