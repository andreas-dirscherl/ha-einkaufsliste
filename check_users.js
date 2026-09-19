const Database = require('better-sqlite3');
const db = new Database('/app/data/app.db');

const users = db.prepare('SELECT username, is_admin FROM users').all();
console.log('Users in database:');
users.forEach(u => console.log(`  - ${u.username} (Admin: ${u.is_admin ? 'Yes' : 'No'})`));
