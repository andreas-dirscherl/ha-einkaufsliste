/**
 * Update list icons in the database
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'data', 'app.db');

console.log('Opening database:', dbPath);
const db = new Database(dbPath);

// Icon mappings for each list
const iconMappings = {
  'Baumarkt': { icon: 'wrench', color: '#8B6F47' },
  'Einkaufsliste': { icon: 'cart', color: '#FF6B6B' },
  'Einkaufsliste, Drogerie': { icon: 'pill', color: '#4ECDC4' },
  'Einkaufsliste, Lebensmittel': { icon: 'utensils', color: '#95E1D3' },
  'Mealie Einkaufsliste': { icon: 'utensils', color: '#FFE66D' },
  'To-do Haus & Garten': { icon: 'sprout', color: '#6BCF7F' }
};

console.log('\nUpdating list icons...\n');

for (const [listName, { icon, color }] of Object.entries(iconMappings)) {
  const stmt = db.prepare('UPDATE lists SET icon = ?, color = ? WHERE name = ?');
  const result = stmt.run(icon, color, listName);
  
  if (result.changes > 0) {
    console.log(`✓ ${listName.padEnd(30)} → icon: ${icon.padEnd(10)} color: ${color}`);
  } else {
    console.log(`✗ ${listName} - not found`);
  }
}

console.log('\n✓ Done! Icons have been updated.');
console.log('\nRefresh your browser to see the new icons.');

db.close();
