const Redis = require('ioredis');
const redis = new Redis({ host: 'localhost', port: 6379 });
redis.hgetall('bull:pricing:15').then(res => {
  console.log(res);
  redis.quit();
});
