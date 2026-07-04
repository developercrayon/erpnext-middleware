import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueueJob } from './src/database/entities/operational.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const queueJobRepo = app.get(getRepositoryToken(QueueJob));
  
  const oldJobs = await queueJobRepo.find({
    where: { queueName: 'products' },
    order: { bullJobId: 'ASC' },
  });

  console.log(`Found ${oldJobs.length} jobs for 'products'.`);
  console.log(oldJobs.map(j => ({ id: j.bullJobId, name: j.jobName, createdDate: j.createdDate, status: j.status })));
  
  await app.close();
}

bootstrap().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
