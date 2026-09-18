import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Candidate database paths in order of preference
const DB_CANDIDATES = [
  process.env.DB_PATH || '/app/data/app.db',
  '/tmp/app.db',
  '/app/app.db'
];

let db = null;
let DB_PATH = null;

/**
 * Initialize SQLite database with all required tables
 */
export function initializeDatabase() {
  // Try each path until one works
  for (const candidate of DB_CANDIDATES) {
    if (DB_PATH) break; // Already found a working path
    
    try {
      const dir = path.dirname(candidate);
      console.log(`[ATTEMPT] Trying database path: ${candidate}`);
      fs.mkdirSync(dir, { recursive: true });
      
      // Check if candidate exists as a directory (shouldn't happen but cleanup if it does)
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        console.warn(`[CLEANUP] ${candidate} exists as directory, renaming to ${candidate}.bak`);
        fs.renameSync(candidate, `${candidate}.bak`);
      }
      
      // Try to open the database - this will CREATE the file if it doesn't exist
      db = new Database(candidate);
      DB_PATH = candidate;
      console.log(`[OK] Database opened successfully at: ${DB_PATH}`);
      break;
    } catch (err) {
      const errorMsg = err.code || err.message;
      console.warn(`[WARN] Failed to open database at ${candidate}: ${errorMsg}`);
      
      // Special warning for cache drive issues
      if (candidate === '/app/data/app.db' && err.code === 'SQLITE_CANTOPEN') {
        console.warn('[WARN] /app/data volume mount may have filesystem issues.');
        console.warn('[WARN] This is a known issue with Unraid cache drives and SQLite.');
        console.warn('[WARN] Data will be stored in /tmp but will NOT persist across container restarts.');
      }
      
      db = null;
    }
  }

  if (!db || !DB_PATH) {
    const errorMsg = `Failed to open database at any candidate path: ${DB_CANDIDATES.join(', ')}`;
    console.error(`[ERROR] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // Use TRUNCATE journal mode for better compatibility
  try {
    db.pragma('journal_mode = TRUNCATE');
    console.log(`[OK] Journal mode set to TRUNCATE`);
  } catch (err) {
    console.warn(`[WARN] Failed to set journal mode: ${err.message}`);
  }
  
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  console.log(`[OK] Database pragmas configured`);

  // Create tables if they don't exist
  createTables();
  
  // Apply schema migrations
  applyMigrations();
  
  return db;
}

/**
 * Get database connection
 */
export function getDatabase() {
  if (!db) {
    initializeDatabase();
  }
  return db;
}

/**
 * Create all required database tables
 */
function createTables() {
  const db = getDatabase();

  // Configuration table (for setup wizard and HA token)
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ha_url TEXT NOT NULL,
      ha_token TEXT NOT NULL,
      encryption_key TEXT NOT NULL,
      is_setup_complete BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Lists (HA todo entities) and user permissions
  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ha_entity_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      icon TEXT,
      color TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // User list permissions
  db.exec(`
    CREATE TABLE IF NOT EXISTS list_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      list_id INTEGER NOT NULL,
      can_read BOOLEAN DEFAULT 1,
      can_write BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
      UNIQUE(user_id, list_id)
    )
  `);

  // Items cache (local cache of HA todo items)
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ha_item_id TEXT UNIQUE NOT NULL,
      list_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      is_completed BOOLEAN DEFAULT 0,
      version INTEGER DEFAULT 0,
      ha_synced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
    )
  `);

  // Offline sync queue (for PWA offline changes)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      data JSON NOT NULL,
      user_id INTEGER,
      synced BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Notifications (for UI alerts and push notifications)
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      data JSON,
      type TEXT DEFAULT 'info',
      read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Create indices for performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_list_id ON items(list_id);
    CREATE INDEX IF NOT EXISTS idx_items_title ON items(title);
    CREATE INDEX IF NOT EXISTS idx_list_permissions_user_id ON list_permissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON sync_queue(synced);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
  `);
}

/**
 * Apply database schema migrations
 */
function applyMigrations() {
  const db = getDatabase();

  // Migration 1: Add HA person entity mapping to users
  try {
    db.prepare('ALTER TABLE users ADD COLUMN ha_person_entity_id TEXT').run();
  } catch (e) {
    // Column already exists, skip
  }

  // Migration 2: Create zone_mappings table for area-based list associations
  db.exec(`
    CREATE TABLE IF NOT EXISTS zone_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      zone_entity_id TEXT NOT NULL,
      zone_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
      UNIQUE(list_id, zone_entity_id)
    )
  `);

  // Create indices for zone mappings
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_zone_mappings_list_id ON zone_mappings(list_id);
    CREATE INDEX IF NOT EXISTS idx_zone_mappings_zone_entity ON zone_mappings(zone_entity_id);
  `);
}

/**
 * Encrypt sensitive data (HA token)
 */
export function encryptToken(token, encryptionKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'hex'), iv);
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt HA token
 */
export function decryptToken(encryptedData, encryptionKey) {
  const [ivHex, encrypted] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'hex'), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Check if setup is complete
 */
export function isSetupComplete() {
  const db = getDatabase();
  try {
    const config = db.prepare('SELECT is_setup_complete FROM config WHERE id = 1').get();
    return config && config.is_setup_complete;
  } catch (e) {
    return false;
  }
}

/**
 * Get current configuration
 */
export function getConfig() {
  const db = getDatabase();
  return db.prepare('SELECT * FROM config WHERE id = 1').get();
}

/**
 * Save initial setup
 */
export function saveSetup(haUrl, haToken, adminUsername, adminPasswordHash) {
  const db = getDatabase();
  const encryptionKey = crypto.randomBytes(32).toString('hex');
  const encryptedToken = encryptToken(haToken, encryptionKey);

  const transaction = db.transaction(() => {
    // Save config
    db.prepare(`
      INSERT INTO config (ha_url, ha_token, encryption_key, is_setup_complete)
      VALUES (?, ?, ?, 1)
    `).run(haUrl, encryptedToken, encryptionKey);

    // Create admin user
    db.prepare(`
      INSERT INTO users (username, password_hash, is_admin)
      VALUES (?, ?, 1)
    `).run(adminUsername, adminPasswordHash);
  });

  transaction();
}

export default {
  initializeDatabase,
  getDatabase,
  isSetupComplete,
  getConfig,
  saveSetup,
  encryptToken,
  decryptToken
};
