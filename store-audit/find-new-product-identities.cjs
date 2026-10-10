const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const input = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3] || path.join(path.dirname(input), 'new-products.json'));
const rows = JSON.parse(fs.readFileSync(input, 'utf8'));
const db = new DatabaseSync(path.join(__dirname, 'db', 'store-audit.sqlite'), { readOnly: true });
const exists = db.prepare('SELECT 1 FROM product_master WHERE store_id=? AND product_id=?');
const newRows = rows.filter((row) => !exists.get('27857268786685', String(row.productId)));
db.close();
fs.writeFileSync(output, JSON.stringify(newRows, null, 2));
console.log(JSON.stringify({ scanned: rows.length, newCount: newRows.length, output }));
