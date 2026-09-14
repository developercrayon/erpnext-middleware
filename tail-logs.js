const fs = require('fs');
const lines = fs.readFileSync('logs/app-2026-09-14.log', 'utf8').split('\n');
console.log(lines.slice(-30).join('\n'));
