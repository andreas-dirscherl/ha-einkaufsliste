import('./backend/database.js').then(async mod => {
  mod.initializeDatabase();
  
  const { getDatabase } = mod;
  const crypto = (await import('crypto')).default;
  
  const db = getDatabase();
  
  // Generate encryption key if config doesn't exist
  const config = db.prepare('SELECT * FROM config WHERE id = 1').get();
  if (!config) {
    const encryptionKey = crypto.randomBytes(32).toString('hex');
    const configInsert = db.prepare(`
      INSERT INTO config (id, ha_url, ha_token, encryption_key, is_setup_complete)
      VALUES (1, 'http://localhost:3000', 'test-token', ?, 1)
    `);
    configInsert.run(encryptionKey);
    console.log('✅ Config initialized with encryption key');
  } else {
    console.log('✅ Config already exists - skipping (your setup preserved)');
  }
  
  // Check if users already exist - don't overwrite!
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    console.log('⚠️  No users found - but NOT creating default user');
    console.log('⚠️  Please use the setup wizard to create your admin account');
  } else {
    console.log('✅ Users already exist - skipping (your passwords preserved)');
  }
  
  console.log('✅ Database structure verified');
  process.exit(0);
}).catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
