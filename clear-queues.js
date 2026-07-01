const Queue = require('bull');
const { Client } = require('pg');

const redisUrl = 'redis://default:gmL6Yb4iwBjsUhVVInZO@194.163.134.149:6395';

async function clearBull(prefix) {
  console.log(`Clearing Bull Queue: ${prefix}`);
  const queues = ['orders', 'products', 'inventory', 'pricing', 'shipments'];
  for (const name of queues) {
    const q = new Queue(name, { redis: redisUrl, prefix });
    await q.empty(); // Removes waiting, active, delayed
    await q.clean(0, 'completed');
    await q.clean(0, 'failed');
    await q.clean(0, 'wait');
    await q.clean(0, 'active');
    await q.clean(0, 'delayed');
    console.log(` - Cleared ${prefix}:${name}`);
    await q.close();
  }
}

async function clearDB() {
  console.log('Clearing Postgres queue_jobs table...');
  const c = new Client({ connectionString: 'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix' });
  await c.connect();
  await c.query("DELETE FROM queue_jobs");
  console.log(' - queue_jobs table cleared');
  await c.end();
}

async function main() {
  try {
    await clearBull('bull');
    await clearBull('bull-dev');
    await clearDB();
    console.log('Done! All queues and DB states are completely clear.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
