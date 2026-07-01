const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Basic env parser
const envPath = path.join(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const dbUrl = env.DB_URL || 'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix';

console.log('Connecting to database:', dbUrl.replace(/:([^:@]+)@/, ':***@'));

const client = new Client({
  connectionString: dbUrl,
});

async function main() {
  await client.connect();
  
  const jobsRes = await client.query(`
    SELECT id, queue_name, job_name, status, created_date, processed_at, completed_at 
    FROM queue_jobs 
    ORDER BY created_date DESC 
    LIMIT 10;
  `);
  
  console.log('\n--- RECENT QUEUE JOBS (RAW DATABASE VALUES) ---');
  jobsRes.rows.forEach(job => {
    console.log(`ID: ${job.id}`);
    console.log(`Queue: ${job.queue_name} | Job: ${job.job_name}`);
    console.log(`Status: ${job.status}`);
    console.log(`Created Date (Raw): ${job.created_date}`);
    console.log(`Processed At (Raw): ${job.processed_at}`);
    console.log(`Completed At (Raw): ${job.completed_at}`);
    console.log('-------------------------------------------');
  });
  
  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
