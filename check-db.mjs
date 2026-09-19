import Database from 'better-sqlite3';

const db = new Database('/app/data/app.db');

const lists = db.prepare('SELECT id, name FROM lists').all();
console.log('Items per list in database:\n');

let totalItems = 0;
lists.forEach(l => {
  const countResult = db.prepare('SELECT COUNT(*) as count FROM items WHERE list_id = ?').get(l.id);
  const count = countResult.count;
  totalItems += count;
  console.log(`  - ${l.name}: ${count} items`);
});

console.log(`\nTotal: ${totalItems} items`);

// Check if item_count column exists
const tableInfo = db.pragma('table_info(lists)');
const hasItemCount = tableInfo.some(col => col.name === 'item_count');
console.log(`\nColumn 'item_count' exists: ${hasItemCount}`);

if (hasItemCount) {
  const listsWithCount = db.prepare('SELECT id, name, item_count FROM lists').all();
  console.log('\nList item_count values:');
  listsWithCount.forEach(l => {
    console.log(`  - ${l.name}: ${l.item_count}`);
  });
}

db.close();
