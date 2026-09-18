import axios from 'axios';
import { getDatabase, getConfig, decryptToken } from './database.js';

/**
 * Home Assistant Integration & Sync
 */

let haConfig = null;

/**
 * Initialize HA Connection
 */
export function initHAConnection() {
  haConfig = getConfig();
  if (!haConfig) {
    console.warn('HA Config not found');
    return false;
  }
  console.log('[OK] HA Connection initialized');
  return true;
}

/**
 * Get HA API Client
 */
export function getHAClient() {
  if (!haConfig) {
    haConfig = getConfig();
  }

  if (!haConfig) {
    throw new Error('HA not configured');
  }

  const token = decryptToken(haConfig.ha_token, haConfig.encryption_key);

  return axios.create({
    baseURL: haConfig.ha_url,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
}

/**
 * Fetch all todo lists from Home Assistant
 */
export async function syncHALists() {
  try {
    const client = getHAClient();
    const db = getDatabase();

    console.log('[syncHALists] Starting sync...');

    // Fetch all states from HA
    let response;
    try {
      response = await client.get('/api/states');
    } catch (err) {
      console.error('[syncHALists] Failed to fetch states from HA:', err.message);
      throw new Error(`HA API error: ${err.message}`);
    }

    const states = response.data;
    console.log(`[syncHALists] Received ${states.length} states from HA`);

    // Filter only todo entities
    const todoEntities = states.filter(state => state.entity_id && state.entity_id.startsWith('todo.'));
    console.log(`[syncHALists] Found ${todoEntities.length} todo entities`);

    if (todoEntities.length === 0) {
      console.warn('[syncHALists] No todo entities found in Home Assistant');
      return 0;
    }

    // Sync lists into database
    for (const entity of todoEntities) {
      try {
        const { entity_id, attributes, state } = entity;
        const name = attributes?.friendly_name || entity_id;
        const description = attributes?.description || null;

        // Insert or update list
        const insertStmt = db.prepare(`
          INSERT INTO lists (ha_entity_id, name, description)
          VALUES (?, ?, ?)
          ON CONFLICT(ha_entity_id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id
        `);
        
        const result = insertStmt.get(entity_id, name, description);
        const listId = result.id;

        console.log(`[syncHALists] Synced HA list: ${name} (${entity_id}) with list_id: ${listId}`);

        // Grant permissions to all admin users
        const admins = db.prepare('SELECT id FROM users WHERE is_admin = 1').all();
        for (const admin of admins) {
          try {
            db.prepare(`
              INSERT INTO list_permissions (list_id, user_id, can_read, can_write)
              VALUES (?, ?, 1, 1)
              ON CONFLICT(list_id, user_id) DO NOTHING
            `).run(listId, admin.id);
            console.log(`[syncHALists] Granted permissions for list ${listId} to user ${admin.id}`);
          } catch (permError) {
            console.warn(`[syncHALists] Failed to grant permission: ${permError.message}`);
          }
        }

        // Sync items from this list
        try {
          await syncHAListItems(entity_id);
        } catch (itemError) {
          console.warn(`[syncHALists] Failed to sync items for ${entity_id}: ${itemError.message}`);
          // Continue with next list instead of failing
        }
      } catch (entityError) {
        console.error(`[syncHALists] Failed to process entity:`, entityError.message);
        // Continue with next entity
      }
    }

    console.log(`[syncHALists] Completed sync of ${todoEntities.length} lists`);
    return todoEntities.length;
  } catch (error) {
    console.error('[syncHALists] Fatal error:', error.message);
    throw error;
  }
}

/**
 * Fetch and sync items from a specific HA todo list
 */
export async function syncHAListItems(haEntityId) {
  try {
    const client = getHAClient();
    const db = getDatabase();

    console.log(`[syncHAListItems] Starting for entity: ${haEntityId}`);

    // Get list from DB
    const list = db.prepare('SELECT id FROM lists WHERE ha_entity_id = ?').get(haEntityId);
    if (!list) {
      console.warn(`[syncHAListItems] List not found in DB for ${haEntityId}`);
      return;
    }

    console.log(`[syncHAListItems] Found list record, list_id: ${list.id}`);

    // Try to fetch items via service call
    let items = [];
    try {
      console.log(`[syncHAListItems] Calling HA service: POST /api/services/todo/get_items`);
      const response = await client.post(`/api/services/todo/get_items`, {
        entity_id: haEntityId
      });

      console.log(`[syncHAListItems] Service response:`, JSON.stringify(response.data).substring(0, 200));
      items = response.data?.[haEntityId]?.items || [];
      console.log(`[syncHAListItems] Extracted ${items.length} items from service response`);
    } catch (serviceError) {
      console.error(`[syncHAListItems] Service call failed: ${serviceError.message}`);
      console.warn(`[syncHAListItems] Falling back to direct state query`);
      
      // Fallback: get items from state directly
      try {
        const response = await client.get(`/api/states/${haEntityId}`);
        const todoState = response.data;
        items = todoState.attributes?.todo_items || [];
        console.log(`[syncHAListItems] Fallback: Got ${items.length} items from state attributes`);
      } catch (fallbackError) {
        console.error(`[syncHAListItems] Fallback also failed: ${fallbackError.message}`);
        throw new Error(`Cannot fetch items: service failed (${serviceError.message}) and fallback failed (${fallbackError.message})`);
      }
    }

    console.log(`[syncHAListItems] Processing ${items.length} items`);

    // Clear old items (or mark as deleted)
    const existingItems = db.prepare('SELECT id, ha_item_id FROM items WHERE list_id = ?').all(list.id);
    const haItemIds = items.map(item => item.uid || item.id).filter(Boolean);

    for (const existing of existingItems) {
      if (!haItemIds.includes(existing.ha_item_id)) {
        // Item was deleted in HA
        db.prepare('DELETE FROM items WHERE id = ?').run(existing.id);
        console.log(`[syncHAListItems] Deleted item: ${existing.ha_item_id}`);
      }
    }

    // Insert/update items from HA
    for (const item of items) {
      try {
        const itemId = item.uid || item.id;
        const title = item.summary || item.title || 'Unnamed item';
        
        db.prepare(`
          INSERT INTO items (ha_item_id, list_id, title, description, is_completed)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(ha_item_id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            is_completed = excluded.is_completed,
            ha_synced_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          itemId,
          list.id,
          title,
          item.description || null,
          item.status === 'needs_action' ? 0 : 1
        );
      } catch (itemError) {
        console.error(`[syncHAListItems] Failed to insert item:`, itemError.message);
      }
    }

    console.log(`[syncHAListItems] Completed: synced ${items.length} items`);
    return items.length;
  } catch (error) {
    console.error(`[syncHAListItems] Fatal error for ${haEntityId}:`, error.message);
    throw error;
  }
}

/**
 * Push item change to Home Assistant
 */
export async function pushItemToHA(item) {
  try {
    const client = getHAClient();
    const db = getDatabase();

    const list = db.prepare('SELECT ha_entity_id FROM lists WHERE id = ?').get(item.list_id);
    if (!list || !item.ha_item_id) {
      console.log('[INFO] Item not synced to HA yet, skipping push');
      return;
    }

    const haEntityId = list.ha_entity_id;

    // If item is completed, update status to "completed"
    if (item.is_completed) {
      await client.post(`/api/services/todo/update_item`, {
        entity_id: haEntityId,
        item: item.ha_item_id,
        status: 'completed'
      });
      console.log(`[OK] Marked as completed in HA: ${item.title}`);
    } else {
      // Item is not completed, set status to "needs_action"
      await client.post(`/api/services/todo/update_item`, {
        entity_id: haEntityId,
        item: item.ha_item_id,
        status: 'needs_action'
      });
      console.log(`[OK] Marked as needs_action in HA: ${item.title}`);
    }

    // Update sync timestamp in local DB
    db.prepare('UPDATE items SET ha_synced_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.id);
  } catch (error) {
    console.error(`[ERROR] Failed to push item to HA:`, error.message);
    throw error;
  }
}

/**
 * Create item in Home Assistant
 */
export async function createItemInHA(item) {
  try {
    const client = getHAClient();
    const db = getDatabase();

    const list = db.prepare('SELECT ha_entity_id FROM lists WHERE id = ?').get(item.list_id);
    if (!list) {
      throw new Error('List not found');
    }

    const haEntityId = list.ha_entity_id;

    // Add new item to HA todo list
    const response = await client.post(`/api/services/todo/add_item`, {
      entity_id: haEntityId,
      item: item.title,
      description: item.description
    });

    console.log(`[OK] Created item in HA: ${item.title}`);

    // Update local DB with HA item ID
    // HA returns the item UID in the response
    if (response.data && response.data[haEntityId]) {
      const haItemId = response.data[haEntityId];
      db.prepare('UPDATE items SET ha_item_id = ?, ha_synced_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(haItemId, item.id);
    }
  } catch (error) {
    console.error(`[ERROR] Failed to create item in HA:`, error.message);
    throw error;
  }
}

/**
 * Delete item from Home Assistant
 */
export async function deleteItemFromHA(item) {
  try {
    const client = getHAClient();
    const db = getDatabase();

    const list = db.prepare('SELECT ha_entity_id FROM lists WHERE id = ?').get(item.list_id);
    if (!list || !item.ha_item_id) {
      console.log('[INFO] Item not in HA, skipping delete');
      return;
    }

    const haEntityId = list.ha_entity_id;

    // Delete from HA
    await client.post(`/api/services/todo/remove_item`, {
      entity_id: haEntityId,
      item: item.ha_item_id
    });

    console.log(`[OK] Deleted item from HA: ${item.title}`);
  } catch (error) {
    console.error(`[ERROR] Failed to delete item from HA:`, error.message);
    throw error;
  }
}

/**
 * Fetch all person entities from Home Assistant
 */
export async function getHAPersons() {
  try {
    const client = getHAClient();

    // Fetch all states from HA
    const response = await client.get('/api/states');
    const states = response.data;

    // Filter only person entities
    const persons = states
      .filter(state => state.entity_id.startsWith('person.'))
      .map(state => ({
        entity_id: state.entity_id,
        friendly_name: state.attributes.friendly_name || state.entity_id,
        icon: state.attributes.icon || 'mdi:account',
        state: state.state
      }));

    console.log(`[INFO] Found ${persons.length} HA persons`);
    return persons;
  } catch (error) {
    console.error('[ERROR] Failed to fetch HA persons:', error.message);
    throw error;
  }
}

/**
 * Fetch all zone entities from Home Assistant
 */
export async function getHAZones() {
  try {
    const client = getHAClient();

    // Fetch all states from HA
    const response = await client.get('/api/states');
    const states = response.data;

    // Filter only zone entities
    const zones = states
      .filter(state => state.entity_id.startsWith('zone.'))
      .map(state => ({
        entity_id: state.entity_id,
        friendly_name: state.attributes.friendly_name || state.entity_id,
        icon: state.attributes.icon || 'mdi:map-marker',
        latitude: state.attributes.latitude,
        longitude: state.attributes.longitude,
        radius: state.attributes.radius
      }));

    console.log(`[INFO] Found ${zones.length} HA zones`);
    return zones;
  } catch (error) {
    console.error('[ERROR] Failed to fetch HA zones:', error.message);
    throw error;
  }
}

/**
 * Get current zone/location of a person entity
 */
export async function getPersonLocation(personEntityId) {
  try {
    const client = getHAClient();

    // Get person state
    const response = await client.get(`/api/states/${personEntityId}`);
    const person = response.data;

    // The state should be the zone entity_id or 'unknown'
    return {
      person_entity_id: personEntityId,
      current_zone: person.state, // e.g., 'zone.home' or 'zone.dm_markt'
      friendly_name: person.attributes.friendly_name || personEntityId,
      last_updated: person.last_updated
    };
  } catch (error) {
    console.error(`[ERROR] Failed to fetch location for ${personEntityId}:`, error.message);
    throw error;
  }
}

export default {
  initHAConnection,
  getHAClient,
  syncHALists,
  syncHAListItems,
  pushItemToHA,
  createItemInHA,
  deleteItemFromHA,
  getHAPersons,
  getHAZones,
  getPersonLocation
};
