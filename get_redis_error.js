const Redis = require('ioredis');
const redis = new Redis('redis://default:gmL6Yb4iwBjsUhVVInZO@194.163.134.149:6395');

async function run() {
  const job = await redis.hgetall('bull:products:2133');
  console.log('JOB:', job);
  process.exit(0);
}
run().catch(console.error);
