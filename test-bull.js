const Queue = require('bull');
const r = 'redis://default:gmL6Yb4iwBjsUhVVInZO@194.163.134.149:6395';
async function test() {
  const q1 = new Queue('products', { redis: r, prefix: 'bull' });
  const w1 = await q1.getWorkers();
  console.log('bull workers:', w1.length);
  
  const q2 = new Queue('products', { redis: r, prefix: 'bull-dev' });
  const w2 = await q2.getWorkers();
  console.log('bull-dev workers:', w2.length);
  process.exit(0);
}
test();
