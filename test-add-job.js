const Queue = require('bull');
const r = 'redis://default:gmL6Yb4iwBjsUhVVInZO@194.163.134.149:6395';
async function test() {
  const q2 = new Queue('products', { redis: r, prefix: 'bull-dev' });
  const job = await q2.add('sync-products', { source: 'AMAZON', skus: ['Woodwolf® Ceramic Coffee Mug Test'] });
  console.log('Added job', job.id);
  process.exit(0);
}
test();
