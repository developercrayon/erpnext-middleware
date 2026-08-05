const { Client } = require('pg'); 
const client = new Client({ connectionString: 'postgresql://inkreatix:inkreatix@194.163.134.149:3455/inkreatix' }); 
client.connect().then(() => client.query('SELECT * FROM item_sync_log WHERE "resourceType" = \'PRICE\' ORDER BY "createdAt" DESC LIMIT 5'))
.then(res => console.log(JSON.stringify(res.rows, null, 2)))
.catch(console.error)
.finally(() => client.end());
