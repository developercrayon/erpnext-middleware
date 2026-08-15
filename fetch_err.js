const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix'
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT * FROM queue_jobs WHERE status = 'FAILED' ORDER BY \"updated_at\" DESC LIMIT 1;");
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run().catch(console.error);
