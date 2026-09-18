/**
 * WebSocket Server für Real-Time Live-Sync
 * Broadcast von Item-Änderungen an alle Clients
 */

import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { getDatabase } from './database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Map: listId → Set of WebSocket connections
const listSubscriptions = new Map();

// Map: userId → Set of WebSocket connections
const userConnections = new Map();

/**
 * Initialize WebSocket Server
 */
export function initWebSocketServer(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    let userId = null;
    let connectedLists = new Set();

    console.log('🔗 WebSocket client connected');

    /**
     * Message Handler
     */
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);

        // Handle different message types
        switch (message.type) {
          case 'auth':
            handleAuth(ws, message, (id) => {
              userId = id;
              // Track this connection
              if (!userConnections.has(userId)) {
                userConnections.set(userId, new Set());
              }
              userConnections.get(userId).add(ws);
              console.log(`✅ User ${userId} authenticated via WebSocket`);
            });
            break;

          case 'subscribe':
            handleSubscribe(ws, message, connectedLists, userId);
            break;

          case 'unsubscribe':
            handleUnsubscribe(ws, message, connectedLists);
            break;

          case 'sync':
            handleSync(ws, message, userId, connectedLists);
            break;

          default:
            ws.send(JSON.stringify({ error: 'Unknown message type' }));
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({ error: error.message }));
      }
    });

    /**
     * Connection Close
     */
    ws.on('close', () => {
      console.log('🔌 WebSocket client disconnected');
      
      // Remove from subscriptions
      for (const [listId, subscribers] of listSubscriptions.entries()) {
        subscribers.delete(ws);
        if (subscribers.size === 0) {
          listSubscriptions.delete(listId);
        }
      }

      // Remove from user connections
      if (userId && userConnections.has(userId)) {
        userConnections.get(userId).delete(ws);
        if (userConnections.get(userId).size === 0) {
          userConnections.delete(userId);
        }
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return wss;
}

/**
 * Handle Authentication
 */
function handleAuth(ws, message, callback) {
  try {
    const token = message.token;
    const payload = jwt.verify(token, JWT_SECRET);
    ws.userId = payload.id;
    callback(payload.id);

    ws.send(JSON.stringify({ type: 'auth', success: true }));
  } catch (error) {
    ws.send(JSON.stringify({ type: 'auth', error: 'Invalid token' }));
  }
}

/**
 * Handle Subscribe to List
 */
function handleSubscribe(ws, message, connectedLists, userId) {
  const listId = message.listId;

  // Verify permission
  const db = getDatabase();
  const perm = db.prepare(`
    SELECT * FROM list_permissions
    WHERE user_id = ? AND list_id = ?
  `).get(userId, listId);

  if (!perm) {
    ws.send(JSON.stringify({ error: 'Access denied' }));
    return;
  }

  // Add to subscriptions
  if (!listSubscriptions.has(listId)) {
    listSubscriptions.set(listId, new Set());
  }
  listSubscriptions.get(listId).add(ws);
  connectedLists.add(listId);

  ws.send(JSON.stringify({ 
    type: 'subscribed', 
    listId,
    message: `Subscribed to list ${listId}`
  }));

  console.log(`👁️ User ${userId} subscribed to list ${listId}`);
}

/**
 * Handle Unsubscribe from List
 */
function handleUnsubscribe(ws, message, connectedLists) {
  const listId = message.listId;

  if (listSubscriptions.has(listId)) {
    listSubscriptions.get(listId).delete(ws);
    if (listSubscriptions.get(listId).size === 0) {
      listSubscriptions.delete(listId);
    }
  }

  connectedLists.delete(listId);
  ws.send(JSON.stringify({ type: 'unsubscribed', listId }));
}

/**
 * Handle Sync Messages (item changes)
 */
function handleSync(ws, message, userId, connectedLists) {
  const db = getDatabase();

  // Verify permission
  const perm = db.prepare(`
    SELECT * FROM list_permissions
    WHERE user_id = ? AND list_id = ?
  `).get(userId, message.listId);

  if (!perm) {
    ws.send(JSON.stringify({ error: 'Access denied' }));
    return;
  }

  // Determine action and get full item data
  let item = null;

  if (message.action === 'create') {
    // For create: item data comes from message
    item = message.item;
  } else {
    // For update/delete: get from DB
    item = db.prepare('SELECT * FROM items WHERE id = ?').get(message.itemId);
  }

  if (!item && message.action !== 'delete') {
    ws.send(JSON.stringify({ error: 'Item not found' }));
    return;
  }

  // Broadcast to all subscribers on this list
  broadcastToList(message.listId, {
    type: 'item-changed',
    action: message.action,
    listId: message.listId,
    item,
    itemId: message.itemId,
    userId,
    timestamp: Date.now()
  }, ws); // exclude sender to avoid double-update

  console.log(`🔄 Broadcasted ${message.action} on list ${message.listId} from user ${userId}`);
}

/**
 * Broadcast message to all subscribers on a list
 */
export function broadcastToList(listId, message, excludeWs = null) {
  if (!listSubscriptions.has(listId)) return;

  const payload = JSON.stringify(message);
  const subscribers = listSubscriptions.get(listId);

  subscribers.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws !== excludeWs) {
      ws.send(payload);
    }
  });
}

/**
 * Broadcast to specific user
 */
export function broadcastToUser(userId, message) {
  if (!userConnections.has(userId)) return;

  const payload = JSON.stringify(message);
  const connections = userConnections.get(userId);

  connections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

/**
 * Get list subscribers count (for debugging)
 */
export function getListSubscriberCount(listId) {
  return listSubscriptions.has(listId) ? listSubscriptions.get(listId).size : 0;
}

export default {
  initWebSocketServer,
  broadcastToList,
  broadcastToUser,
  getListSubscriberCount
};
