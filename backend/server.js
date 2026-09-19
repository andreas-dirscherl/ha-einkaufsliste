import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import crypto from 'crypto';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import http from 'http';
import {
  initializeDatabase,
  getDatabase,
  isSetupComplete,
  getConfig,
  saveSetup,
  decryptToken,
  encryptToken
} from './database.js';
import {
  initHAConnection,
  syncHALists,
  syncHAListItems,
  pushItemToHA,
  createItemInHA,
  deleteItemFromHA,
  getHAPersons,
  getHAZones,
  getPersonLocation
} from './ha-integration.js';
import {
  initWebSocketServer,
  broadcastToList,
  broadcastToUser
} from './websocket-server.js';
import { startHAPolling, stopHAPolling } from './ha-polling.js';
import { startPersonPolling, stopPersonPolling } from './ha-person-polling.js';
import { SyncManager, NotificationManager } from './sync-manager.js';
import { getCategory, getAllCategories } from './categories.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Create HTTP server for WebSocket
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Initialize database on startup
initializeDatabase();

/**
 * Middleware: Redirect to setup if not complete
 */
app.use((req, res, next) => {
  // Allow setup routes regardless
  if (req.path.startsWith('/api/setup') || req.path === '/setup.html') {
    return next();
  }

  if (!isSetupComplete()) {
    // If it's an API call, return error
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({ error: 'Setup required', redirect: '/setup.html' });
    }
    // Redirect all other requests to setup
    return res.redirect('/setup.html');
  }

  next();
});

/**
 * Middleware: Verify JWT token + Auto-refresh (rolling 30-day window)
 */
function verifyToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    
    // Auto-refresh: Create new token for rolling 30-day window
    const newToken = jwt.sign(
      { 
        id: req.user.id, 
        username: req.user.username, 
        isAdmin: req.user.isAdmin 
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    // Send new token in response header
    res.set('x-new-token', newToken);
    res.set('Access-Control-Expose-Headers', 'x-new-token');
    
    console.log(`[TOKEN] Verified & refreshed for ${req.user.username}`);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Middleware: Verify admin access
 */
function requireAdmin(req, res, next) {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * SETUP WIZARD ROUTES
 */

// GET /api/setup/status - Check if setup is complete
app.get('/api/setup/status', (req, res) => {
  res.json({ setupComplete: isSetupComplete() });
});

// POST /api/setup/init - Initialize the app (create admin, save HA config)
app.post('/api/setup/init', async (req, res) => {
  try {
    if (isSetupComplete()) {
      return res.status(403).json({ error: 'Setup already complete' });
    }

    const { adminUsername, adminPassword, haUrl, haToken } = req.body;

    // Validate inputs
    if (!adminUsername || !adminPassword || !haUrl || !haToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (adminPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Test HA connection
    try {
      const response = await fetch(`${haUrl}/api/states`, {
        headers: { Authorization: `Bearer ${haToken}` }
      });
      if (!response.ok) {
        throw new Error('Invalid HA credentials');
      }
    } catch (error) {
      return res.status(400).json({ error: 'Failed to connect to Home Assistant' });
    }

    // Hash password
    const passwordHash = await bcryptjs.hash(adminPassword, 10);

    // Save to database
    saveSetup(haUrl, haToken, adminUsername, passwordHash);

    // Initialize HA connection
    initHAConnection();

    // Sync HA lists immediately
    try {
      const count = await syncHALists();
      console.log(`[OK] Synced ${count} lists from Home Assistant`);
    } catch (error) {
      console.error('[ERROR] Failed to sync HA lists:', error.message);
      // Don't fail setup, but warn admin
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: 1, username: adminUsername, isAdmin: true },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: { id: 1, username: adminUsername, isAdmin: true }
    });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * HOME ASSISTANT RESOURCES ROUTES (for setup & admin)
 */

// GET /api/setup/ha-persons - Get available HA person entities
app.get('/api/setup/ha-persons', async (req, res) => {
  try {
    if (!isSetupComplete()) {
      return res.status(403).json({ error: 'Setup not complete' });
    }

    const persons = await getHAPersons();
    res.json(persons);
  } catch (error) {
    console.error('Failed to fetch HA persons:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/setup/ha-zones - Get available HA zone entities
app.get('/api/setup/ha-zones', async (req, res) => {
  try {
    if (!isSetupComplete()) {
      return res.status(403).json({ error: 'Setup not complete' });
    }

    const zones = await getHAZones();
    res.json(zones);
  } catch (error) {
    console.error('Failed to fetch HA zones:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * AUTH ROUTES
 */

// POST /api/auth/login
// Login handler (shared by both endpoints)
async function handleLogin(req, res) {
  try {
    const { username, password } = req.body;
    const db = getDatabase();

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordValid = await bcryptjs.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if 2FA is enabled
    if (user.two_factor_enabled) {
      // Generate a temporary token for 2FA verification (valid for 5 minutes)
      const tempToken = jwt.sign(
        { id: user.id, username: user.username, isAdmin: user.is_admin, twoFAVerified: false },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      
      return res.json({
        success: false,
        requiresTwoFA: true,
        tempToken: tempToken,
        message: '2FA code required'
      });
    }

    // Standard login (no 2FA)
    const token = jwt.sign(
      { id: user.id, username: user.username, isAdmin: user.is_admin },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, isAdmin: user.is_admin }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.post('/api/auth/login', handleLogin);
app.post('/api/login', handleLogin);

/**
 * ADMIN ROUTES
 */

// GET /api/admin/users - List all users
app.get('/api/admin/users', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const users = db.prepare('SELECT id, username, is_admin, ha_person_entity_id, created_at FROM users ORDER BY created_at DESC').all();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/users - Create new user (admin only)
app.post('/api/admin/users', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, isAdmin } = req.body;
    const db = getDatabase();

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const passwordHash = await bcryptjs.hash(password, 10);

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, is_admin)
      VALUES (?, ?, ?)
    `).run(username, passwordHash, isAdmin ? 1 : 0);

    const user = db.prepare('SELECT id, username, is_admin, created_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid);

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/users/:userId - Delete user (admin only)
app.delete('/api/admin/users/:userId', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();

    if (parseInt(req.params.userId) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/users/:userId - Update user (admin only)
app.patch('/api/admin/users/:userId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { password, isAdmin } = req.body;
    const db = getDatabase();
    const userId = parseInt(req.params.userId);

    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      const passwordHash = await bcryptjs.hash(password, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    }

    if (isAdmin !== undefined) {
      db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
    }

    const user = db.prepare('SELECT id, username, is_admin, created_at FROM users WHERE id = ?').get(userId);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PERMISSION MANAGEMENT
 */

// GET /api/admin/permissions - Get all user-list permissions
app.get('/api/admin/permissions', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const permissions = db.prepare(`
      SELECT 
        lp.id,
        lp.user_id,
        lp.list_id,
        lp.can_read,
        lp.can_write,
        u.username,
        l.name as list_name,
        l.ha_entity_id
      FROM list_permissions lp
      JOIN users u ON lp.user_id = u.id
      JOIN lists l ON lp.list_id = l.id
      ORDER BY u.username, l.name
    `).all();
    res.json(permissions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/permissions - Create or update permission
app.post('/api/admin/permissions', verifyToken, requireAdmin, (req, res) => {
  try {
    const { userId, listId, canRead, canWrite } = req.body;
    const db = getDatabase();

    if (!userId || !listId) {
      return res.status(400).json({ error: 'userId and listId required' });
    }

    // Check if permission already exists
    const existing = db.prepare(`
      SELECT id FROM list_permissions WHERE user_id = ? AND list_id = ?
    `).get(userId, listId);

    if (existing) {
      db.prepare(`
        UPDATE list_permissions 
        SET can_read = ?, can_write = ?
        WHERE user_id = ? AND list_id = ?
      `).run(canRead ? 1 : 0, canWrite ? 1 : 0, userId, listId);
    } else {
      db.prepare(`
        INSERT INTO list_permissions (user_id, list_id, can_read, can_write)
        VALUES (?, ?, ?, ?)
      `).run(userId, listId, canRead ? 1 : 0, canWrite ? 1 : 0);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/permissions/:permissionId - Remove permission
app.delete('/api/admin/permissions/:permissionId', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM list_permissions WHERE id = ?').run(req.params.permissionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * USER-PERSON MAPPING ROUTES
 */

// PATCH /api/users/:userId/ha-person - Map app user to HA person entity
app.patch('/api/users/:userId/ha-person', verifyToken, requireAdmin, (req, res) => {
  try {
    // Accept both camelCase (from frontend) and snake_case
    const haPersonEntityId = req.body.haPersonEntityId || req.body.ha_person_entity_id || null;
    const db = getDatabase();

    // Verify user exists
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user with HA person mapping (allow null to remove mapping)
    db.prepare('UPDATE users SET ha_person_entity_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(haPersonEntityId, req.params.userId);

    const updated = db.prepare('SELECT id, username, is_admin, ha_person_entity_id, created_at FROM users WHERE id = ?')
      .get(req.params.userId);

    const personStr = haPersonEntityId ? `HA person ${haPersonEntityId}` : 'no person';
    console.log(`[OK] Mapped user ${user.username} to ${personStr}`);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/users/:userId/password - Change user password
app.patch('/api/users/:userId/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = parseInt(req.params.userId);
    
    // Users can only change their own password unless they're admin
    if (req.user.id !== userId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const passwordMatch = await bcryptjs.compare(currentPassword, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash and update new password
    const newHash = await bcryptjs.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newHash, userId);

    console.log(`[OK] Password changed for user ${user.username}`);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/users/:userId/username - Change username
app.patch('/api/users/:userId/username', verifyToken, async (req, res) => {
  try {
    const { newUsername, password } = req.body;
    const userId = parseInt(req.params.userId);
    
    // Users can only change their own username unless they're admin
    if (req.user.id !== userId && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!newUsername || !password) {
      return res.status(400).json({ error: 'New username and password required' });
    }

    if (newUsername.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify password
    const passwordMatch = await bcryptjs.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }

    // Check if username already exists
    const existing = db.prepare('SELECT * FROM users WHERE username = ? AND id != ?').get(newUsername, userId);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    db.prepare('UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newUsername, userId);

    console.log(`[OK] Username changed for user ${user.username} → ${newUsername}`);
    res.json({ success: true, message: 'Username changed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/config/ha-token - Update Home Assistant token and URL
app.patch('/api/config/ha-token', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { haUrl, haToken } = req.body;

    if (!haUrl || !haToken) {
      return res.status(400).json({ error: 'Home Assistant URL and token required' });
    }

    // Test HA connection
    try {
      const response = await fetch(`${haUrl}/api/states`, {
        headers: { Authorization: `Bearer ${haToken}` }
      });
      if (!response.ok) {
        return res.status(400).json({ error: 'Invalid Home Assistant credentials' });
      }
    } catch (error) {
      return res.status(400).json({ error: 'Failed to connect to Home Assistant: ' + error.message });
    }

    const db = getDatabase();
    const config = db.prepare('SELECT * FROM config WHERE id = 1').get();
    
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }

    // Update HA config with encrypted token
    const encryptedToken = encryptToken(haToken, config.encryption_key);
    db.prepare('UPDATE config SET ha_url = ?, ha_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1')
      .run(haUrl, encryptedToken);

    // Reinitialize HA connection
    initHAConnection();

    console.log('[OK] Home Assistant configuration updated');
    res.json({ success: true, message: 'Home Assistant configuration updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/config - Get config info (safe version without secrets)
app.get('/api/config', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const config = db.prepare('SELECT id, ha_url, is_setup_complete FROM config WHERE id = 1').get();
    
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }

    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/:userId - Get user details including HA person mapping
app.get('/api/users/:userId', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();
    
    // User can only view their own details, or admins can view any user
    if (req.user.id !== parseInt(req.params.userId) && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const user = db.prepare('SELECT id, username, is_admin, ha_person_entity_id, two_factor_enabled, created_at FROM users WHERE id = ?')
      .get(req.params.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * TWO-FACTOR AUTHENTICATION ROUTES
 */

// Helper: Generate backup codes (10 codes, 8 characters each)
function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    codes.push(code);
  }
  return codes;
}

// Helper: Hash backup code for storage
function hashBackupCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// POST /api/2fa/setup - Initiate 2FA setup (get secret and QR code)
app.post('/api/2fa/setup', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const db = getDatabase();
    
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `Einkaufsliste (${user.username})`,
      issuer: 'Einkaufsliste',
      length: 32
    });

    // Generate QR code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    // Generate backup codes
    const backupCodes = generateBackupCodes();
    const backupCodesHashed = backupCodes.map(code => hashBackupCode(code));

    res.json({
      success: true,
      secret: secret.base32,
      qrCode: qrCode,
      backupCodes: backupCodes,
      backupCodesForStorage: backupCodesHashed
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/2fa/enable - Enable 2FA (verify code and save secret)
app.post('/api/2fa/enable', verifyToken, (req, res) => {
  try {
    const userId = req.user.id;
    const { secret, code, backupCodesHashed } = req.body;

    if (!secret || !code || !backupCodesHashed || !Array.isArray(backupCodesHashed)) {
      return res.status(400).json({ error: 'Secret, code, and backup codes required' });
    }

    // Verify the code
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: code.toString(),
      window: 2
    });

    if (!verified) {
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    // Save to database
    const db = getDatabase();
    db.prepare('UPDATE users SET two_factor_secret = ?, two_factor_enabled = 1, backup_codes = ? WHERE id = ?')
      .run(secret, JSON.stringify(backupCodesHashed), userId);

    console.log(`[OK] 2FA enabled for user ${req.user.username}`);
    res.json({ success: true, message: '2FA successfully enabled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/2fa/verify - Verify 2FA code during login
app.post('/api/2fa/verify', (req, res) => {
  try {
    const { tempToken, code } = req.body;

    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Temp token and code required' });
    }

    // Verify the temporary token
    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ error: '2FA verification timeout. Please login again.' });
    }

    if (decoded.twoFAVerified) {
      return res.status(400).json({ error: 'Token already verified' });
    }

    // Get user and verify 2FA code
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);

    if (!user || !user.two_factor_enabled) {
      return res.status(400).json({ error: 'User does not have 2FA enabled' });
    }

    // Try main secret first
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code.toString(),
      window: 2
    });

    let isBackupCode = false;
    if (!verified && user.backup_codes) {
      // Try backup codes
      const backupCodesHashed = JSON.parse(user.backup_codes);
      const codeHash = hashBackupCode(code.toString());
      
      const backupIndex = backupCodesHashed.findIndex(h => h === codeHash);
      if (backupIndex !== -1) {
        isBackupCode = true;
        // Remove used backup code
        backupCodesHashed.splice(backupIndex, 1);
        db.prepare('UPDATE users SET backup_codes = ? WHERE id = ?')
          .run(JSON.stringify(backupCodesHashed), decoded.id);
        console.log(`[OK] 2FA backup code used by user ${user.username}`);
      }
    }

    if (!verified && !isBackupCode) {
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    // Generate actual login token
    const loginToken = jwt.sign(
      { id: user.id, username: user.username, isAdmin: user.is_admin },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`[OK] 2FA verification successful for user ${user.username}`);
    res.json({
      success: true,
      token: loginToken,
      user: { id: user.id, username: user.username, isAdmin: user.is_admin }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/2fa/disable - Disable 2FA
app.post('/api/2fa/disable', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    // Verify password
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    const passwordValid = await bcryptjs.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Disable 2FA
    db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, backup_codes = NULL WHERE id = ?')
      .run(userId);

    console.log(`[OK] 2FA disabled for user ${user.username}`);
    res.json({ success: true, message: '2FA successfully disabled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/2fa/backup-codes - Generate new backup codes
app.post('/api/2fa/backup-codes', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }

    // Verify password
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    const passwordValid = await bcryptjs.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    if (!user.two_factor_enabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    // Generate new backup codes
    const backupCodes = generateBackupCodes();
    const backupCodesHashed = backupCodes.map(code => hashBackupCode(code));

    db.prepare('UPDATE users SET backup_codes = ? WHERE id = ?')
      .run(JSON.stringify(backupCodesHashed), userId);

    console.log(`[OK] New backup codes generated for user ${user.username}`);
    res.json({
      success: true,
      backupCodes: backupCodes,
      message: 'New backup codes generated'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ZONE MAPPING ROUTES
 */

// GET /api/lists/:listId/zones - Get zones associated with a list
app.get('/api/lists/:listId/zones', verifyToken, (req, res) => {
  try {
    const db = getDatabase();
    
    // Check access to list
    const permission = db.prepare('SELECT * FROM list_permissions WHERE user_id = ? AND list_id = ?')
      .get(req.user.id, req.params.listId);

    if (!permission && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const zones = db.prepare(`
      SELECT id, zone_entity_id, zone_name, created_at
      FROM zone_mappings
      WHERE list_id = ?
      ORDER BY zone_name ASC
    `).all(req.params.listId);

    res.json(zones);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/lists/:listId/zones - Set zones for a list (admin only)
app.patch('/api/lists/:listId/zones', verifyToken, requireAdmin, (req, res) => {
  try {
    const { zones } = req.body; // Array of { zone_entity_id, zone_name }
    const db = getDatabase();

    // Verify list exists
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.listId);
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    if (!Array.isArray(zones)) {
      return res.status(400).json({ error: 'zones must be an array' });
    }

    // Clear existing zone mappings for this list
    db.prepare('DELETE FROM zone_mappings WHERE list_id = ?').run(req.params.listId);

    // Insert new zone mappings
    const insert = db.prepare(`
      INSERT INTO zone_mappings (list_id, zone_entity_id, zone_name)
      VALUES (?, ?, ?)
    `);

    for (const zone of zones) {
      insert.run(req.params.listId, zone.zone_entity_id, zone.zone_name);
    }

    console.log(`[OK] Updated zones for list ${list.name}: ${zones.map(z => z.zone_name).join(', ')}`);

    // Broadcast to subscribers
    broadcastToList(req.params.listId, {
      type: 'list-updated',
      listId: req.params.listId,
      list: db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.listId)
    });

    const updatedZones = db.prepare('SELECT * FROM zone_mappings WHERE list_id = ?').all(req.params.listId);
    res.json(updatedZones);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ZONE MAPPING ADMIN ROUTES
 */

// GET /api/admin/zones - Get all zone mappings
app.get('/api/admin/zones', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const zones = db.prepare(`
      SELECT 
        zm.id,
        zm.list_id,
        zm.zone_entity_id,
        zm.zone_name,
        l.name as list_name,
        l.ha_entity_id
      FROM zone_mappings zm
      JOIN lists l ON zm.list_id = l.id
      ORDER BY l.name, zm.zone_name
    `).all();
    res.json(zones);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/zones - Create zone mapping
app.post('/api/admin/zones', verifyToken, requireAdmin, (req, res) => {
  try {
    const { listId, zoneEntityId, zoneName } = req.body;
    const db = getDatabase();

    if (!listId || !zoneEntityId || !zoneName) {
      return res.status(400).json({ error: 'listId, zoneEntityId, and zoneName required' });
    }

    // Check if mapping already exists
    const existing = db.prepare(`
      SELECT id FROM zone_mappings WHERE list_id = ? AND zone_entity_id = ?
    `).get(listId, zoneEntityId);

    if (existing) {
      return res.status(400).json({ error: 'Zone mapping already exists' });
    }

    const result = db.prepare(`
      INSERT INTO zone_mappings (list_id, zone_entity_id, zone_name)
      VALUES (?, ?, ?)
    `).run(listId, zoneEntityId, zoneName);

    const zone = db.prepare('SELECT * FROM zone_mappings WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(zone);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/zones/:zoneId - Delete zone mapping
app.delete('/api/admin/zones/:zoneId', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM zone_mappings WHERE id = ?').run(req.params.zoneId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * CATEGORY MANAGEMENT (Tags like "Drogerie", "Lebensmittel", etc.)
 */

// GET /api/admin/categories - Get all categories
app.get('/api/admin/categories', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const categories = db.prepare(`
      SELECT 
        c.id,
        c.name,
        c.created_at,
        COUNT(cz.id) as zone_count,
        COUNT(l.id) as list_count
      FROM categories c
      LEFT JOIN category_zones cz ON c.id = cz.category_id
      LEFT JOIN lists l ON l.category_id = c.id
      GROUP BY c.id
      ORDER BY c.name
    `).all();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/categories - Create new category
app.post('/api/admin/categories', verifyToken, requireAdmin, (req, res) => {
  try {
    const { name } = req.body;
    const db = getDatabase();

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Category name required' });
    }

    // Check if category already exists
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
    if (existing) {
      return res.status(400).json({ error: 'Category already exists' });
    }

    const result = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
    
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/categories/:categoryId - Delete category
app.delete('/api/admin/categories/:categoryId', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const categoryId = parseInt(req.params.categoryId);

    // Remove category from lists
    db.prepare('UPDATE lists SET category_id = NULL WHERE category_id = ?').run(categoryId);
    
    // Delete category zones
    db.prepare('DELETE FROM category_zones WHERE category_id = ?').run(categoryId);
    
    // Delete category
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/admin/categories/:categoryId/zones - Get zones for a category
app.get('/api/admin/categories/:categoryId/zones', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const categoryId = parseInt(req.params.categoryId);

    const zones = db.prepare(`
      SELECT 
        id,
        category_id,
        zone_entity_id,
        zone_name,
        created_at
      FROM category_zones
      WHERE category_id = ?
      ORDER BY zone_name
    `).all(categoryId);

    res.json(zones);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/categories/:categoryId/zones - Add zone to category
app.post('/api/admin/categories/:categoryId/zones', verifyToken, requireAdmin, (req, res) => {
  try {
    const { zoneEntityId, zoneName } = req.body;
    const categoryId = parseInt(req.params.categoryId);
    const db = getDatabase();

    if (!zoneEntityId || !zoneName) {
      return res.status(400).json({ error: 'zoneEntityId and zoneName required' });
    }

    // Check if mapping already exists
    const existing = db.prepare(`
      SELECT id FROM category_zones WHERE category_id = ? AND zone_entity_id = ?
    `).get(categoryId, zoneEntityId);

    if (existing) {
      return res.status(400).json({ error: 'Zone already assigned to this category' });
    }

    const result = db.prepare(`
      INSERT INTO category_zones (category_id, zone_entity_id, zone_name)
      VALUES (?, ?, ?)
    `).run(categoryId, zoneEntityId, zoneName);

    const zone = db.prepare('SELECT * FROM category_zones WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(zone);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/admin/categories/:categoryId/zones/:zoneId - Remove zone from category
app.delete('/api/admin/categories/:categoryId/zones/:zoneId', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM category_zones WHERE id = ?').run(req.params.zoneId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * HA SYNC ROUTES
 */

// GET /api/admin/lists-for-sync - Get all lists with HA entity IDs for sync
app.get('/api/admin/lists-for-sync', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const lists = db.prepare(`
      SELECT 
        id,
        name,
        ha_entity_id,
        description,
        category_id,
        icon,
        color
      FROM lists
      ORDER BY name
    `).all();
    res.json(lists);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/sync/lists - Force sync lists from HA
app.post('/api/admin/sync/lists', verifyToken, requireAdmin, async (req, res) => {
  try {
    const count = await syncHALists();
    res.json({ success: true, listsCount: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/sync/list/:listId - Force sync single list items
app.post('/api/admin/sync/list/:listId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const db = getDatabase();
    const list = db.prepare('SELECT ha_entity_id FROM lists WHERE id = ?').get(req.params.listId);

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    await syncHAListItems(list.ha_entity_id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

/**
 * USER ROUTES
 */

// GET /api/user/current-zone - Get user's current zone and suggested lists
app.get('/api/user/current-zone', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();
    
    // Get user's HA person entity ID
    const user = db.prepare('SELECT ha_person_entity_id FROM users WHERE id = ?').get(req.user.id);
    
    if (!user || !user.ha_person_entity_id) {
      return res.json({ 
        zone: null, 
        suggestedLists: [],
        message: 'No HA person assigned' 
      });
    }
    
    // Get current zone from HA
    const location = await getPersonLocation(user.ha_person_entity_id);
    
    if (!location) {
      return res.json({ 
        zone: null, 
        suggestedLists: [],
        message: 'Location not available'
      });
    }
    
    // Get lists associated with this zone
    const lists = db.prepare(`
      SELECT DISTINCT l.* FROM lists l
      JOIN list_zones lz ON l.id = lz.list_id
      JOIN zones z ON lz.zone_id = z.id
      WHERE z.ha_entity_id = ?
      AND l.id IN (
        SELECT list_id FROM list_permissions 
        WHERE user_id = ? AND can_read = 1
      )
      ORDER BY l.name
    `).all(location.zone, req.user.id);
    
    res.json({
      zone: location.zone,
      friendly_name: location.friendly_name,
      suggestedLists: lists.map(l => ({
        id: l.id,
        name: l.name,
        icon: l.icon,
        color: l.color
      }))
    });
  } catch (error) {
    console.error('[USER] Zone error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/user/profile - Update current user's profile (password, etc.)
app.patch('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const { password, currentPassword } = req.body;
    const db = getDatabase();
    
    // Get current user
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // If password change requested
    if (password) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password required for changes' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }

      // Verify current password
      const passwordMatch = await bcryptjs.compare(currentPassword, user.password_hash);
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // Hash and update new password
      const newHash = await bcryptjs.hash(password, 10);
      db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(newHash, req.user.id);

      console.log(`[OK] Password changed for user ${user.username}`);
    }

    // Return success
    res.json({ 
      success: true, 
      message: password ? 'Password changed successfully' : 'Profile updated',
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.is_admin
      }
    });
  } catch (error) {
    console.error('[PROFILE] Update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/2fa-status - Get 2FA status for current user
app.get('/api/user/2fa-status', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      enabled: user.two_factor_enabled ? true : false,
      method: user.two_factor_enabled ? 'totp' : null
    });
  } catch (error) {
    console.error('[2FA] Status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/2fa-initiate - Start 2FA setup and return QR code
app.post('/api/user/2fa-initiate', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.two_factor_enabled) {
      return res.status(400).json({ error: '2FA is already enabled' });
    }

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      name: `Einkaufsliste (${user.username})`,
      issuer: 'Einkaufsliste'
    });

    // Generate QR code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    // Generate backup codes (6 codes, 8 characters each)
    const backupCodes = Array(6)
      .fill(0)
      .map(() => crypto.randomBytes(4).toString('hex').toUpperCase());

    // Store temporary secret and backup codes in session (not yet enabled)
    // We'll store them in DB but marked as pending
    db.prepare(`
      UPDATE users 
      SET two_factor_secret = ?, backup_codes = ?
      WHERE id = ?
    `).run(secret.base32, JSON.stringify(backupCodes), req.user.id);

    console.log(`[2FA] Initiated for user ${user.username}`);

    res.json({
      secret: secret.base32,
      qrCode,
      backupCodes,
      message: 'Scan the QR code with your authenticator app and verify'
    });
  } catch (error) {
    console.error('[2FA] Initiate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/user/2fa-verify - Verify 2FA code and enable 2FA
app.post('/api/user/2fa-verify', verifyToken, async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code required' });
    }

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.two_factor_secret) {
      return res.status(400).json({ error: 'No 2FA setup in progress' });
    }

    // Verify the code
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 2 // Allow 2 time windows before/after current
    });

    if (!verified) {
      console.log(`[2FA] Invalid code for user ${user.username}`);
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    // Enable 2FA
    db.prepare(`
      UPDATE users 
      SET two_factor_enabled = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.user.id);

    console.log(`[2FA] Enabled for user ${user.username}`);

    res.json({
      success: true,
      message: '2FA has been enabled successfully',
      backupCodes: user.backup_codes ? JSON.parse(user.backup_codes) : []
    });
  } catch (error) {
    console.error('[2FA] Verify error:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/user/2fa - Disable 2FA
app.delete('/api/user/2fa', verifyToken, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password required to disable 2FA' });
    }

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify password
    const passwordMatch = await bcryptjs.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Disable 2FA
    db.prepare(`
      UPDATE users 
      SET two_factor_enabled = 0, two_factor_secret = NULL, backup_codes = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.user.id);

    console.log(`[2FA] Disabled for user ${user.username}`);

    res.json({
      success: true,
      message: '2FA has been disabled'
    });
  } catch (error) {
    console.error('[2FA] Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * LISTS ROUTES
 */

// GET /api/lists - Get all lists user has access to
app.get('/api/lists', verifyToken, (req, res) => {
  try {
    const db = getDatabase();
    
    // Admins see all lists, regular users only see lists they have permissions for
    let lists;
    if (req.user.is_admin) {
      lists = db.prepare(`
        SELECT * FROM lists ORDER BY name
      `).all();
    } else {
      lists = db.prepare(`
        SELECT l.* FROM lists l
        JOIN list_permissions lp ON l.id = lp.list_id
        WHERE lp.user_id = ? AND lp.can_read = 1
        ORDER BY l.name
      `).all(req.user.id);
    }
    
    // Add dynamic item count to each list
    const listsWithCounts = lists.map(list => {
      // Count only active (not completed) items
      const activeCount = db.prepare('SELECT COUNT(*) as count FROM items WHERE list_id = ? AND is_completed = 0').get(list.id).count;
      // Count completed items
      const completedCount = db.prepare('SELECT COUNT(*) as count FROM items WHERE list_id = ? AND is_completed = 1').get(list.id).count;
      return { ...list, item_count: activeCount, completed_count: completedCount };
    });
    
    res.json(listsWithCounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/lists/:id - Get single list with items
app.get('/api/lists/:id', verifyToken, (req, res) => {
  try {
    const db = getDatabase();
    
    // Check permission
    const perm = db.prepare(`
      SELECT * FROM list_permissions
      WHERE user_id = ? AND list_id = ? AND can_read = 1
    `).get(req.user.id, req.params.id);

    if (!perm) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(req.params.id);
    const items = db.prepare('SELECT * FROM items WHERE list_id = ? ORDER BY is_completed ASC, created_at DESC').all(req.params.id);

    res.json({ ...list, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/lists/:id - Update list (icon, color, category) - admin only
app.patch('/api/admin/lists/:id', verifyToken, requireAdmin, (req, res) => {
  try {
    // Accept both 'category' and 'categoryId' parameter names
    // Check if categoryId was explicitly provided (even if null)
    const categoryIdProvided = 'categoryId' in req.body || 'category' in req.body;
    const categoryId = req.body.categoryId !== undefined ? req.body.categoryId : req.body.category;
    
    const { icon, color, name, description } = req.body;
    const db = getDatabase();
    const listId = parseInt(req.params.id);

    const updates = [];
    const values = [];

    if (icon !== undefined) {
      updates.push('icon = ?');
      values.push(icon);
    }

    if (color !== undefined) {
      updates.push('color = ?');
      values.push(color);
    }

    // Update category if explicitly provided (including null to clear it)
    if (categoryIdProvided) {
      updates.push('category_id = ?');
      values.push(categoryId || null);  // null or the actual ID
    }

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }

    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(listId);
    
    const query = `UPDATE lists SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(query).run(...values);

    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
    
    // Broadcast to all users on this list
    broadcastToList(listId, {
      type: 'list-updated',
      listId: listId,
      list
    });
    
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ITEMS ROUTES
 */

// POST /api/lists/:listId/items - Add item (with duplicate detection + HA sync)
app.post('/api/lists/:listId/items', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();
    const { title, description } = req.body;

    // Check permission
    const perm = db.prepare(`
      SELECT * FROM list_permissions
      WHERE user_id = ? AND list_id = ? AND can_write = 1
    `).get(req.user.id, req.params.listId);

    if (!perm) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Smart duplicate detection:
    // If an item with the same title exists and is completed, uncheck it
    const existingItem = db.prepare(`
      SELECT * FROM items
      WHERE list_id = ? AND LOWER(title) = LOWER(?) AND is_completed = 1
    `).get(req.params.listId, title);

    if (existingItem) {
      // Reactivate the existing item instead of creating a duplicate
      db.prepare('UPDATE items SET is_completed = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(existingItem.id);

      // Push to HA
      try {
        await pushItemToHA(existingItem);
      } catch (haError) {
        console.warn('Failed to sync to HA:', haError.message);
      }

      return res.json({
        ...existingItem,
        is_completed: 0,
        message: 'Item reactivated (was already in list as completed)'
      });
    }

    // Create new item locally first
    const result = db.prepare(`
      INSERT INTO items (list_id, title, description, ha_item_id)
      VALUES (?, ?, ?, ?)
    `).run(req.params.listId, title, description, `local_${Date.now()}`);

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);

    console.log(`[POST /items] Created item locally: ${item.title} (id: ${item.id}, ha_id: ${item.ha_item_id})`);

    // Push to HA in background
    try {
      await createItemInHA(item);
      console.log(`[POST /items] ✓ Successfully pushed to HA: ${item.title}`);
    } catch (haError) {
      console.warn(`[POST /items] ⚠ Failed to push to HA: ${item.title} - ${haError.message}`);
      // Item still created locally, will retry on next sync cycle
    }

    // Broadcast to all users on this list (real-time sync)
    broadcastToList(req.params.listId, {
      type: 'item-created',
      listId: req.params.listId,
      item,
      userId: req.user.id,
      timestamp: new Date().toISOString()
    });

    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/items/:itemId - Toggle item completion + sync to HA
app.patch('/api/items/:itemId', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();
    const { isCompleted } = req.body;

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check list permission
    const perm = db.prepare(`
      SELECT * FROM list_permissions
      WHERE user_id = ? AND list_id = ? AND can_write = 1
    `).get(req.user.id, item.list_id);

    if (!perm) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Update locally
    db.prepare('UPDATE items SET is_completed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(isCompleted ? 1 : 0, req.params.itemId);

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.itemId);

    // Push to HA in background
    try {
      await pushItemToHA(updated);
    } catch (haError) {
      console.warn('Failed to sync to HA:', haError.message);
      // Item still updated locally
    }

    // Broadcast to all users on this list (real-time sync)
    broadcastToList(updated.list_id, {
      type: 'item-updated',
      listId: updated.list_id,
      item: updated,
      userId: req.user.id,
      timestamp: new Date().toISOString()
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/items/:itemId - Delete item + sync to HA
app.delete('/api/items/:itemId', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Check permission
    const perm = db.prepare(`
      SELECT * FROM list_permissions
      WHERE user_id = ? AND list_id = ? AND can_write = 1
    `).get(req.user.id, item.list_id);

    if (!perm) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete locally first
    db.prepare('DELETE FROM items WHERE id = ?').run(req.params.itemId);

    // Delete from HA in background
    try {
      await deleteItemFromHA(item);
    } catch (haError) {
      console.warn('Failed to delete from HA:', haError.message);
    }

    // Broadcast to all users on this list (real-time sync)
    broadcastToList(item.list_id, {
      type: 'item-deleted',
      listId: item.list_id,
      itemId: req.params.itemId,
      userId: req.user.id,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * CATEGORIES ROUTES
 */

// GET /api/categories - Get all available categories
app.get('/api/categories', (req, res) => {
  try {
    res.json(getAllCategories());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


/**
 * LIST SHARING ROUTES
 */

// GET /api/admin/lists/:listId/users - Get users with access to a list
app.get('/api/admin/lists/:listId/users', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const listId = parseInt(req.params.listId);

    // Verify list exists
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    // Get all users with permissions for this list
    const users = db.prepare(`
      SELECT u.id, u.username, lp.can_read, lp.can_write
      FROM users u
      LEFT JOIN list_permissions lp ON u.id = lp.user_id AND lp.list_id = ?
      ORDER BY u.username ASC
    `).all(listId);

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/admin/lists/:listId/users - Update list permissions for users
app.patch('/api/admin/lists/:listId/users', verifyToken, requireAdmin, (req, res) => {
  try {
    const { userIds } = req.body; // Array of user IDs that should have access
    const db = getDatabase();
    const listId = parseInt(req.params.listId);

    // Verify list exists
    const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    if (!Array.isArray(userIds)) {
      return res.status(400).json({ error: 'userIds must be an array' });
    }

    // Delete existing permissions for this list
    db.prepare('DELETE FROM list_permissions WHERE list_id = ?').run(listId);

    // Insert new permissions
    const insert = db.prepare(`
      INSERT INTO list_permissions (user_id, list_id, can_read, can_write)
      VALUES (?, ?, 1, 1)
    `);

    for (const userId of userIds) {
      insert.run(userId, listId);
    }

    console.log(`[OK] Updated sharing for list ${list.name}: ${userIds.length} users`);

    // Get updated permissions
    const users = db.prepare(`
      SELECT u.id, u.username, lp.can_read, lp.can_write
      FROM users u
      LEFT JOIN list_permissions lp ON u.id = lp.user_id AND lp.list_id = ?
      ORDER BY u.username ASC
    `).all(listId);

    // Broadcast to subscribers
    broadcastToList(listId, {
      type: 'list-sharing-updated',
      listId: listId,
      users: users.filter(u => u.can_read)
    });

    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * NOTIFICATIONS ROUTES
 */

// GET /api/notifications - Get user's notifications
app.get('/api/notifications', verifyToken, (req, res) => {
  try {
    const db = getDatabase();
    const limit = parseInt(req.query.limit) || 20;
    const notifications = NotificationManager.getNotifications(db, req.user.id, limit);
    
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/notifications/summary - Get notification count
app.get('/api/notifications/summary', verifyToken, (req, res) => {
  try {
    const db = getDatabase();
    const summary = NotificationManager.getNotificationSummary(db, req.user.id);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/notifications/:id/read - Mark notification as read
app.post('/api/notifications/:id/read', verifyToken, (req, res) => {
  try {
    const db = getDatabase();
    
    // Verify ownership
    const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    if (!notif || notif.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    NotificationManager.markAsRead(db, req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * USER LOCATION & ZONE DETECTION ROUTES
 */

// GET /api/user/current-zone - Get current HA zone for logged-in user
app.get('/api/user/current-zone', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();

    // Get user details including HA person entity
    const user = db.prepare('SELECT id, username, ha_person_entity_id FROM users WHERE id = ?')
      .get(req.user.id);

    if (!user || !user.ha_person_entity_id) {
      return res.status(400).json({ error: 'User has no HA person entity mapped' });
    }

    // Get current location from HA
    const location = await getPersonLocation(user.ha_person_entity_id);

    res.json(location);
  } catch (error) {
    console.error('Failed to get user location:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/user/recommended-list - Get list recommended based on current zone
app.get('/api/user/recommended-list', verifyToken, async (req, res) => {
  try {
    const db = getDatabase();

    // Get user details including HA person entity
    const user = db.prepare('SELECT id, username, ha_person_entity_id FROM users WHERE id = ?')
      .get(req.user.id);

    if (!user || !user.ha_person_entity_id) {
      return res.json({ recommendedList: null, reason: 'User has no HA person entity mapped' });
    }

    try {
      // Get current location from HA
      const location = await getPersonLocation(user.ha_person_entity_id);

      if (location.current_zone === 'unknown' || !location.current_zone) {
        return res.json({ recommendedList: null, reason: 'User location unknown', zone: location.current_zone });
      }

      // Find lists that are associated with this zone
      const zonesWithLists = db.prepare(`
        SELECT l.* 
        FROM lists l
        JOIN zone_mappings zm ON l.id = zm.list_id
        WHERE zm.zone_entity_id = ?
        LIMIT 1
      `).get(location.current_zone);

      if (!zonesWithLists) {
        return res.json({ 
          recommendedList: null, 
          reason: 'No list mapped for current zone',
          zone: location.current_zone 
        });
      }

      // Check if user has access to this list
      const permission = db.prepare('SELECT * FROM list_permissions WHERE user_id = ? AND list_id = ?')
        .get(req.user.id, zonesWithLists.id);

      if (!permission) {
        return res.json({ 
          recommendedList: null, 
          reason: 'No access to list for current zone',
          zone: location.current_zone 
        });
      }

      // Return the recommended list
      const list = db.prepare('SELECT id, name, description, category, icon, color FROM lists WHERE id = ?')
        .get(zonesWithLists.id);

      console.log(`[OK] Recommended list for ${user.username} in zone ${location.current_zone}: ${list.name}`);

      res.json({
        recommendedList: list,
        zone: location.current_zone,
        personLocation: location.friendly_name
      });
    } catch (haError) {
      // If HA is unreachable, return null
      console.warn('[INFO] Could not fetch location from HA:', haError.message);
      res.json({ recommendedList: null, reason: 'HA unreachable', error: haError.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * HEALTH CHECK
 */
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Start server with WebSocket support
 */
const wss = initWebSocketServer(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OK] Shopping List Server running on http://0.0.0.0:${PORT}`);
  console.log(`📱 Open http://localhost:${PORT}/setup.html to initialize`);
  console.log(`[OK] WebSocket ready for real-time sync`);
  
  // Initialize HA connection if setup is complete
  const setupComplete = isSetupComplete();
  console.log(`[DEBUG] Setup complete: ${setupComplete}`);
  
  if (setupComplete) {
    initHAConnection();
    // Start HA polling for real-time updates
    startHAPolling();
    // Start person location polling for zone-aware recommendations
    startPersonPolling();
  } else {
    console.log('[DEBUG] Setup not complete - Polling not started');
  }
});
