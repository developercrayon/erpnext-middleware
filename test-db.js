const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix' });
c.connect().then(async () => {
  const r2 = await c.query("SELECT id, status, job_name, created_date, updated_at FROM queue_jobs ORDER BY created_date DESC LIMIT 5");
  console.log("Queue jobs:");
  console.table(r2.rows);
  
  const r3 = await c.query("SELECT id, message, created_at FROM error_logs ORDER BY created_at DESC LIMIT 5");
  console.log("Errors:");
  console.table(r3.rows);

  const r4 = await c.query("SELECT sku, \"amazonAsin\" FROM products WHERE sku LIKE '%Woodwolf%'");
  console.log("amazonAsin:");
  console.table(r4.rows);

  c.end();
});


