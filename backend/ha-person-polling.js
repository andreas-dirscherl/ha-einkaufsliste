/**
 * Home Assistant Person Zone Polling
 * Continuously monitors user locations and broadcasts changes
 */

import { getDatabase } from './database.js';
import { getPersonLocation, getHAPersons } from './ha-integration.js';
import { broadcastToUser } from './websocket-server.js';

const PERSON_POLLING_INTERVAL_MS = 5000; // Check every 5 seconds

let personPollingTimer = null;
const personLocationCache = new Map(); // Track previous locations to detect changes

/**
 * Start polling person locations from HA
 */
export function startPersonPolling() {
  if (personPollingTimer) {
    console.log('[DEBUG] Person polling already running');
    return;
  }

  console.log('[PERSON-POLLING] Starting person location polling (every 5 seconds)');
  personPollingTimer = setInterval(runPersonPollingCycle, PERSON_POLLING_INTERVAL_MS);

  // Run immediately first
  runPersonPollingCycle();
}

/**
 * Stop polling person locations
 */
export function stopPersonPolling() {
  if (personPollingTimer) {
    clearInterval(personPollingTimer);
    personPollingTimer = null;
    console.log('[PERSON-POLLING] Stopped person location polling');
  }
}

/**
 * Main polling cycle - fetch all user person locations
 */
async function runPersonPollingCycle() {
  try {
    const db = getDatabase();

    // Get all users with HA person entity mapped
    const usersWithPerson = db.prepare(`
      SELECT id, username, ha_person_entity_id 
      FROM users 
      WHERE ha_person_entity_id IS NOT NULL AND ha_person_entity_id != ''
    `).all();

    if (usersWithPerson.length === 0) {
      // No users mapped to HA persons
      return;
    }

    console.log(`[PERSON-POLLING] Checking ${usersWithPerson.length} users`);

    // Check each user's location
    for (const user of usersWithPerson) {
      try {
        await checkAndBroadcastUserLocation(db, user);
      } catch (error) {
        console.error(`[PERSON-POLLING] Error checking location for user ${user.username}:`, error.message);
      }
    }
  } catch (error) {
    console.error('[PERSON-POLLING] Cycle error:', error.message);
  }
}

/**
 * Check user's location and broadcast if changed
 */
async function checkAndBroadcastUserLocation(db, user) {
  try {
    // Get current location from HA
    const location = await getPersonLocation(user.ha_person_entity_id);
    if (!location) {
      console.log(`[PERSON-POLLING] No location data for ${user.username}`);
      return;
    }
    
    const currentZone = location.current_zone;
    
    // Get cached previous location
    const cacheKey = `user_${user.id}`;
    const previousZone = personLocationCache.get(cacheKey);

    // Only broadcast if location changed or it's the first check
    if (previousZone !== currentZone) {
      console.log(`[PERSON-POLLING] ${user.username}: ${previousZone || 'unknown'} → ${currentZone}`);
      
      // Update cache
      personLocationCache.set(cacheKey, currentZone);

      // Get recommended list for new zone
      let recommendedListId = null;
      let recommendedListName = null;
      
      if (currentZone && currentZone !== 'unknown') {
        console.log(`[PERSON-POLLING] Looking for list mapped to zone: ${currentZone}`);
        
        const listMapping = db.prepare(`
          SELECT l.id, l.name 
          FROM lists l
          JOIN zone_mappings zm ON l.id = zm.list_id
          WHERE zm.zone_entity_id = ? AND l.id IN (
            SELECT list_id FROM list_permissions WHERE user_id = ?
          )
          LIMIT 1
        `).get(currentZone, user.id);

        if (listMapping) {
          recommendedListId = listMapping.id;
          recommendedListName = listMapping.name;
          console.log(`[PERSON-POLLING] Found mapped list: "${recommendedListName}" (ID: ${recommendedListId})`);
        } else {
          console.log(`[PERSON-POLLING] No list mapped to zone ${currentZone} for user ${user.username}`);
        }
      } else {
        console.log(`[PERSON-POLLING] Zone is unknown/empty, not looking for recommendations`);
      }

      // Broadcast location change to user
      const messagePayload = {
        type: 'location-changed',
        userId: user.id,
        previousZone: previousZone || 'unknown',
        currentZone: currentZone,
        recommendedListId: recommendedListId,
        recommendedListName: recommendedListName,
        timestamp: new Date().toISOString()
      };
      
      console.log(`[PERSON-POLLING] Broadcasting to user ${user.id}:`, JSON.stringify(messagePayload, null, 2));
      broadcastToUser(user.id, messagePayload);
    }
  } catch (error) {
    // HA might be unreachable, log but don't crash
    if (error.message.includes('Connection refused') || error.message.includes('404')) {
      console.log(`[PERSON-POLLING] HA unreachable for ${user.username}`);
    } else {
      throw error;
    }
  }
}

export default {
  startPersonPolling,
  stopPersonPolling
};
