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
    const items = db.prepare('SELECT * FROM items WHERE list_id = ? ORDER BY created_at DESC').all(req.params.id);

    res.json({ ...list, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ITEMS ROUTES
 */

// POST /api/lists/:listId/items - Add item (with duplicate detection)
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

      return res.json({
        ...existingItem,
        is_completed: 0,
        message: 'Item reactivated (was already in list as completed)'
      });
    }

    // Create new item
    const result = db.prepare(`
      INSERT INTO items (list_id, title, description, ha_item_id)
      VALUES (?, ?, ?, ?)
    `).run(req.params.listId, title, description, `local_${Date.now()}`);

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PATCH /api/items/:itemId - Toggle item completion
app.patch('/api/items/:itemId', verifyToken, (req, res) => {
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

    db.prepare('UPDATE items SET is_completed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(isCompleted ? 1 : 0, req.params.itemId);

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.itemId);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/items/:itemId - Delete item
app.delete('/api/items/:itemId', verifyToken, (req, res) => {
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

    db.prepare('DELETE FROM items WHERE id = ?').run(req.params.itemId);
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
});
