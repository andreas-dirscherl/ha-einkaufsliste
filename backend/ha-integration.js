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
  console.log('✅ HA Connection initialized');
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

    // Fetch all states from HA
    const response = await client.get('/api/states');
    const states = response.data;

    // Filter only todo entities
    const todoEntities = states.filter(state => state.entity_id.startsWith('todo.'));

    console.log(`📡 Found ${todoEntities.length} HA todo lists`);

    // Sync lists into database
    for (const entity of todoEntities) {
      const { entity_id, attributes, state } = entity;
      const name = attributes.friendly_name || entity_id;
      const description = attributes.description || null;

      // Insert or update list
      db.prepare(`
        INSERT INTO lists (ha_entity_id, name, description)
        VALUES (?, ?, ?)
        ON CONFLICT(ha_entity_id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          updated_at = CURRENT_TIMESTAMP
      `).run(entity_id, name, description);

      console.log(`✅ Synced HA list: ${name} (${entity_id})`);

      // Sync items from this list
      await syncHAListItems(entity_id);
    }

    return todoEntities.length;
  } catch (error) {
    console.error('❌ Failed to sync HA lists:', error.message);
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

    // Get list from DB
    const list = db.prepare('SELECT id FROM lists WHERE ha_entity_id = ?').get(haEntityId);
    if (!list) {
      console.warn(`List not found for ${haEntityId}`);
      return;
    }

    // Call HA service to get todo items
    const response = await client.post(`/api/services/todo/get_items`, {
      entity_id: haEntityId
    });

    const items = response.data?.[haEntityId]?.items || [];

    console.log(`📡 Synced ${items.length} items from ${haEntityId}`);

    // Clear old items (or mark as deleted)
    // For now: update ha_synced_at to distinguish old/new
    const existingItems = db.prepare('SELECT id, ha_item_id FROM items WHERE list_id = ?').all(list.id);
    const haItemIds = items.map(item => item.uid);

    for (const existing of existingItems) {
      if (!haItemIds.includes(existing.ha_item_id)) {
        // Item was deleted in HA
        db.prepare('DELETE FROM items WHERE id = ?').run(existing.id);
        console.log(`🗑️ Deleted item: ${existing.ha_item_id}`);
      }
    }

    // Insert/update items from HA
    for (const item of items) {
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
        item.uid,
        list.id,
        item.summary,
        item.description || null,
        item.status === 'needs_action' ? 0 : 1
      );
    }

    return items.length;
  } catch (error) {
    console.error(`❌ Failed to sync items for ${haEntityId}:`, error.message);
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
      console.log('ℹ️ Item not synced to HA yet, skipping push');
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
      console.log(`✅ Marked as completed in HA: ${item.title}`);
    } else {
      // Item is not completed, set status to "needs_action"
      await client.post(`/api/services/todo/update_item`, {
        entity_id: haEntityId,
        item: item.ha_item_id,
        status: 'needs_action'
      });
      console.log(`✅ Marked as needs_action in HA: ${item.title}`);
    }

    // Update sync timestamp in local DB
    db.prepare('UPDATE items SET ha_synced_at = CURRENT_TIMESTAMP WHERE id = ?').run(item.id);
  } catch (error) {
    console.error(`❌ Failed to push item to HA:`, error.message);
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

    console.log(`✅ Created item in HA: ${item.title}`);

    // Update local DB with HA item ID
    // HA returns the item UID in the response
    if (response.data && response.data[haEntityId]) {
      const haItemId = response.data[haEntityId];
      db.prepare('UPDATE items SET ha_item_id = ?, ha_synced_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(haItemId, item.id);
    }
  } catch (error) {
    console.error(`❌ Failed to create item in HA:`, error.message);
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
      console.log('ℹ️ Item not in HA, skipping delete');
      return;
    }

    const haEntityId = list.ha_entity_id;

    // Delete from HA
    await client.post(`/api/services/todo/remove_item`, {
      entity_id: haEntityId,
      item: item.ha_item_id
    });

    console.log(`✅ Deleted item from HA: ${item.title}`);
  } catch (error) {
    console.error(`❌ Failed to delete item from HA:`, error.message);
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

    console.log(`📡 Found ${persons.length} HA persons`);
    return persons;
  } catch (error) {
    console.error('❌ Failed to fetch HA persons:', error.message);
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

    console.log(`📡 Found ${zones.length} HA zones`);
    return zones;
  } catch (error) {
    console.error('❌ Failed to fetch HA zones:', error.message);
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
    console.error(`❌ Failed to fetch location for ${personEntityId}:`, error.message);
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
