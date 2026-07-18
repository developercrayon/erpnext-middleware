const { Client } = require('pg');
require('dotenv').config();

async function fixTable() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    console.log('Connected to DB');
    
    // Vacuum full to reclaim dropped columns and reset the column counter
    console.log('Running VACUUM FULL on error_logs...');
    await client.query('VACUUM FULL "error_logs"');
    console.log('VACUUM FULL completed successfully!');
    
  } catch (err) {
    console.error('Failed to fix table:', err);
  } finally {
    await client.end();
  }
}

fixTable();
