/**
 * Home Assistant Polling & Real-Time Broadcast
 * Polls HA for changes and broadcasts updates to all connected clients
 */

import { getDatabase } from './database.js';
import { syncHALists, syncHAListItems } from './ha-integration.js';
import { broadcastToList } from './websocket-server.js';

let pollingInterval = null;
const POLLING_INTERVAL_MS = 3000; // Poll every 3 seconds (faster real-time updates)

/**
 * Start HA polling and broadcasting
 */
export function startHAPolling() {
  console.log('[POLLING] Starting HA sync polling...');

  // Run immediately on start
  runHAPollingCycle();

  // Then run on interval
  pollingInterval = setInterval(runHAPollingCycle, POLLING_INTERVAL_MS);
}

/**
 * Stop HA polling
 */
export function stopHAPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[POLLING] Stopped HA sync polling');
  }
}

/**
 * Run one polling cycle
 */
async function runHAPollingCycle() {
  try {
    const db = getDatabase();

    // Get all lists from DB
    const lists = db.prepare('SELECT id, ha_entity_id FROM lists WHERE ha_entity_id IS NOT NULL').all();

    if (lists.length === 0) {
      return;
    }

    console.log(`[POLLING] Running sync cycle for ${lists.length} lists`);

    // Sync each list from HA
    for (const list of lists) {
      try {
        await syncHAListItems(list.ha_entity_id);

        // After sync, get items and broadcast to all clients watching this list
        const items = db.prepare(`
          SELECT id, title, description, is_completed, ha_item_id
          FROM items
          WHERE list_id = ?
          ORDER BY is_completed ASC, created_at DESC
        `).all(list.id);

        // Broadcast full list update to all subscribers
        broadcastToList(list.id, {
          type: 'list-updated',
          listId: list.id,
          items: items,
          timestamp: Date.now(),
          source: 'ha-sync'
        });

        console.log(`[POLLING] Synced and broadcasted ${items.length} items for list ${list.id}`);
      } catch (error) {
        console.error(`[POLLING] Error syncing list ${list.id}:`, error.message);
        // Continue with next list instead of failing
      }
    }
  } catch (error) {
    console.error('[POLLING] Fatal error in polling cycle:', error.message);
  }
}
