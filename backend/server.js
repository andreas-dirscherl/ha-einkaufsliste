import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import {
  initializeDatabase,
  getDatabase,
  isSetupComplete,
  getConfig,
  saveSetup,
  decryptToken
} from './database.js';
import {
  initHAConnection,
  syncHALists,
  syncHAListItems,
  pushItemToHA,
  createItemInHA,
  deleteItemFromHA
} from './ha-integration.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
 * Middleware: Verify JWT token
 */
function verifyToken(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
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
      console.log(`✅ Synced ${count} lists from Home Assistant`);
    } catch (error) {
      console.error('⚠️ Failed to sync HA lists:', error.message);
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
 * AUTH ROUTES
 */

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
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
});

/**
 * ADMIN ROUTES
 */

// GET /api/admin/users - List all users
app.get('/api/admin/users', verifyToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const users = db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at DESC').all();
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
        l.name,
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
 * HA SYNC ROUTES
 */

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
 * LISTS ROUTES
 */

// GET /api/lists - Get all lists user has access to
app.get('/api/lists', verifyToken, (req, res) => {
  try {
    const db = getDatabase();
    const lists = db.prepare(`
      SELECT l.* FROM lists l
      JOIN list_permissions lp ON l.id = lp.list_id
      WHERE lp.user_id = ?
    `).all(req.user.id);

    res.json(lists);
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

    // Push to HA in background
    try {
      await createItemInHA(item);
    } catch (haError) {
      console.warn('Failed to create in HA:', haError.message);
      // Item still created locally, will retry on sync
    }

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

    res.json({ success: true });
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
 * Start server
 */
app.listen(PORT, () => {
  console.log(`🛒 Shopping List Server running on http://localhost:${PORT}`);
  console.log(`📱 Open http://localhost:${PORT}/setup.html to initialize`);
  
  // Initialize HA connection if setup is complete
  if (isSetupComplete()) {
    initHAConnection();
  }
});
