const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'shopping.db');
const db = new Database(dbPath);

try {
  // First, let's see what we have
  console.log('\n📋 Current list icons:');
  const lists = db.prepare('SELECT id, name, icon FROM lists ORDER BY id').all();
  lists.forEach(list => {
    console.log(`  ${list.id}: ${list.name} → ${list.icon || 'NULL'}`);
  });

  console.log('\n🔄 Updating icons...');
  
  // Update icons based on list name patterns
  const updates = [
    { 
      id: 1, 
      newIcon: 'apple', 
      name: 'Mealie Einkaufsliste',
      reason: 'Lebensmittel - Apfel Icon'
    },
    { 
      id: 3, 
      newIcon: 'apple', 
      name: 'Einkaufsliste, Lebensmittel',
      reason: 'Lebensmittel - Apfel Icon'
    },
  ];

  for (const item of updates) {
    db.prepare('UPDATE lists SET icon = ? WHERE id = ?').run(item.newIcon, item.id);
    console.log(`  ✓ ${item.name} → ${item.newIcon} (${item.reason})`);
  }

  console.log('\n✅ Final icons:');
  const updated = db.prepare('SELECT id, name, icon FROM lists ORDER BY id').all();
  updated.forEach(list => {
    console.log(`  ${list.id}: ${list.name} → ${list.icon || 'NULL'}`);
  });

} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  db.close();
}
