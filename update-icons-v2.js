const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'shopping.db');
const db = new Database(dbPath);

try {
  // Map old icon keys to new ones
  const updates = [
    { id: 1, newIcon: 'apple', name: 'Mealie Einkaufsliste' },
    { id: 3, newIcon: 'apple', name: 'Einkaufsliste, Lebensmittel' },
  ];

  for (const item of updates) {
    db.prepare('UPDATE lists SET icon = ? WHERE id = ?').run(item.newIcon, item.id);
    console.log(`✓ ${item.name} → icon: ${item.newIcon}`);
  }

  console.log('\n✅ Icon update complete!');
} catch (error) {
  console.error('Error:', error.message);
} finally {
  db.close();
}
