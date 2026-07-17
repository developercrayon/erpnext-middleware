require('dotenv').config(); 
const axios = require('axios'); 
const token = 'token ' + process.env.ERPNEXT_API_KEY + ':' + process.env.ERPNEXT_API_SECRET; 
const fs = require('fs');
const lines = fs.readFileSync('logs/app-2026-07-17.log', 'utf8').split('\n');
const line = lines.find(l => l.includes('Final ERPNext payload for B0H5Q41BRH:'));
if (!line) {
  console.log('Payload not found!');
  process.exit(1);
}
const payloadStr = line.substring(line.indexOf('{'));
const payload = JSON.parse(payloadStr);

axios.put('https://woodwolf.t3elements.com/api/resource/Item/B0H5Q41BRH', payload, {headers:{Authorization: token}})
  .then(r => console.log('Success'))
  .catch(e => { 
    console.log('ERROR STATUS:', e.response?.status);
    console.log('MESSAGES:', e.response?.data?._server_messages); 
    console.log('EXC:', e.response?.data?.exc); 
    console.log('EXCEPTION:', e.response?.data?.exception); 
  });
