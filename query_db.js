const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');
db.all('SELECT sku, isParent, variantOf FROM product WHERE sku IN ("B0H6J6Y2CV", "B0H6JDNX73", "B0H6JN2R8Q", "B0H6JKKCJK")', [], (err, rows) => {
  console.log(rows);
});
