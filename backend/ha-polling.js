/**
 * Home Assistant Polling & Real-Time Broadcast
 * Polls HA for changes and broadcasts updates to all connected clients
 */

import { getDatabase } from './database.js';
import { syncHALists, syncHAListItems, createItemInHA } from './ha-integration.js';
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
        // Step 1: Retry pushing items that failed before (have local_* IDs)
        await retryFailedHAPushes(list.id);

        // Step 2: Sync items from HA
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

/**
 * Retry pushing items that failed before (with local_* IDs)
 */
async function retryFailedHAPushes(listId) {
  try {
    const db = getDatabase();

    // Find all items with local_* IDs (failed pushes)
    const failedItems = db.prepare(`
      SELECT * FROM items
      WHERE list_id = ? AND ha_item_id LIKE 'local_%'
    `).all(listId);

    if (failedItems.length === 0) return;

    console.log(`[RETRY-HA] Found ${failedItems.length} items to retry for list ${listId}`);

    for (const item of failedItems) {
      try {
        await createItemInHA(item);
        console.log(`[RETRY-HA] ✓ Successfully pushed to HA: ${item.title} (id: ${item.id})`);
      } catch (error) {
        console.warn(`[RETRY-HA] Still failing: ${item.title} - ${error.message}`);
        // Will retry again next cycle
      }
    }
  } catch (error) {
    console.warn('[RETRY-HA] Error in retry process:', error.message);
  }
}
