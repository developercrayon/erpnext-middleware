import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueueJob } from './src/database/entities/operational.entity';
import * as fs from 'fs';

async function bootstrap() {
  console.log('Bootstrapping NestJS context to query QueueJobs...');
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const queueJobRepo = app.get(getRepositoryToken(QueueJob));
  
  const jobs = await queueJobRepo.find({
    order: { createdDate: 'DESC' },
    take: 10
  });

  console.log(`Found ${jobs.length} jobs.`);
  
  const output = JSON.stringify(jobs, null, 2);
  fs.writeFileSync('queue_jobs_output.json', output);
  console.log('Saved to queue_jobs_output.json');

  await app.close();
}

bootstrap().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
