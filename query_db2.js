const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');
db.get('SELECT attributes, isParent FROM product WHERE sku = "B0H6JN2R8Q"', [], (err, row) => {
  if(row) {
    console.log("isParent:", row.isParent);
    const attrs = JSON.parse(row.attributes);
    console.log(JSON.stringify(attrs.relationships, null, 2));
  } else { console.log("Not found"); }
});
