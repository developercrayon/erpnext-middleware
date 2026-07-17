const fs = require('fs');
let c = fs.readFileSync('test_55.js', 'utf8');
c = c.replace(/"cm"/g, '"Centimeter"');
fs.writeFileSync('test_55.js', c);
