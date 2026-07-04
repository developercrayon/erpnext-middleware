require('dotenv').config();
const { DataSource } = require('typeorm');
const { QueueJob } = require('./dist/database/entities/operational.entity');

async function checkDb() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [QueueJob],
  });

  await ds.initialize();
  const repo = ds.getRepository(QueueJob);
  const jobs = await repo.find({
    order: { createdDate: 'DESC' },
    take: 10
  });

  console.log('Top 10 Queue Jobs in DB:');
  jobs.forEach(j => console.log(`${j.id} | ${j.bullJobId} | ${j.queueName} | ${j.jobName} | ${j.status} | err: ${j.errorMessage}`));
  
  await ds.destroy();
}

checkDb().catch(console.error);
