/**
 * Web Push Notifications Manager
 * Handles subscription management and sending push notifications via Web Push API
 */

import webpush from 'web-push';
import { getDatabase } from './database.js';

// Get VAPID keys from environment or generate defaults
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'VAPID_PUBLIC_KEY_NOT_SET';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'VAPID_PRIVATE_KEY_NOT_SET';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

// Configure web-push with VAPID keys
if (VAPID_PUBLIC_KEY !== 'VAPID_PUBLIC_KEY_NOT_SET' && VAPID_PRIVATE_KEY !== 'VAPID_PRIVATE_KEY_NOT_SET') {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log('[PUSH] Web Push VAPID keys configured');
  } catch (error) {
    console.error('[PUSH] Failed to set VAPID details:', error.message);
  }
} else {
  console.warn('[PUSH] VAPID keys not configured - push notifications will be unavailable');
}

/**
 * Store a push subscription for a user
 */
export async function savePushSubscription(userId, subscription, deviceName = 'Unknown Device') {
  try {
    const db = getDatabase();
    
    // Validate subscription object
    if (!subscription.endpoint || !subscription.keys) {
      throw new Error('Invalid subscription object: missing endpoint or keys');
    }

    const { endpoint, keys } = subscription;
    
    // Check if subscription already exists
    const existing = db.prepare(
      'SELECT id FROM push_subscriptions WHERE endpoint = ?'
    ).get(endpoint);

    if (existing) {
      // Update existing subscription
      db.prepare(`
        UPDATE push_subscriptions 
        SET user_id = ?, auth = ?, p256dh = ?, device_name = ?, is_active = 1, updated_at = CURRENT_TIMESTAMP
        WHERE endpoint = ?
      `).run(userId, keys.auth, keys.p256dh, deviceName, endpoint);
      
      console.log(`[PUSH] Updated subscription for user ${userId}`);
    } else {
      // Insert new subscription
      db.prepare(`
        INSERT INTO push_subscriptions (user_id, endpoint, auth, p256dh, device_name, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(userId, endpoint, keys.auth, keys.p256dh, deviceName);
      
      console.log(`[PUSH] Saved new subscription for user ${userId}`);
    }

    return { success: true, subscriptionId: existing?.id };
  } catch (error) {
    console.error('[PUSH] Error saving subscription:', error.message);
    throw error;
  }
}

/**
 * Remove a push subscription
 */
export async function removePushSubscription(endpoint) {
  try {
    const db = getDatabase();
    
    const result = db.prepare(
      'DELETE FROM push_subscriptions WHERE endpoint = ?'
    ).run(endpoint);

    if (result.changes > 0) {
      console.log('[PUSH] Subscription removed');
      return { success: true };
    } else {
      return { success: false, message: 'Subscription not found' };
    }
  } catch (error) {
    console.error('[PUSH] Error removing subscription:', error.message);
    throw error;
  }
}

/**
 * Get all push subscriptions for a user
 */
export function getUserSubscriptions(userId) {
  try {
    const db = getDatabase();
    
    return db.prepare(
      'SELECT id, endpoint, device_name, created_at FROM push_subscriptions WHERE user_id = ? AND is_active = 1'
    ).all(userId);
  } catch (error) {
    console.error('[PUSH] Error fetching subscriptions:', error.message);
    return [];
  }
}

/**
 * Send a push notification to a user
 * Attempts to send to all active subscriptions
 */
export async function sendPushToUser(userId, notification) {
  try {
    // Check if VAPID keys are configured
    if (VAPID_PUBLIC_KEY === 'VAPID_PUBLIC_KEY_NOT_SET') {
      console.log(`[PUSH] VAPID keys not configured - skipping push to user ${userId}`);
      return { success: false, reason: 'VAPID keys not configured' };
    }

    const db = getDatabase();
    
    // Get all active subscriptions for this user
    const subscriptions = db.prepare(
      'SELECT * FROM push_subscriptions WHERE user_id = ? AND is_active = 1'
    ).all(userId);

    if (subscriptions.length === 0) {
      console.log(`[PUSH] No active subscriptions for user ${userId}`);
      return { success: false, reason: 'No subscriptions', sentCount: 0 };
    }

    const payload = JSON.stringify(notification);
    let successCount = 0;
    let failureCount = 0;
    const failedEndpoints = [];

    // Send to each subscription
    for (const sub of subscriptions) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            auth: sub.auth,
            p256dh: sub.p256dh
          }
        };

        await webpush.sendNotification(pushSubscription, payload);
        successCount++;
        console.log(`[PUSH] Notification sent to device: ${sub.device_name}`);
      } catch (error) {
        failureCount++;
        
        // Check if subscription is invalid/expired
        if (error.statusCode === 410 || error.statusCode === 404) {
          // Gone or Not Found - subscription is no longer valid
          console.log(`[PUSH] Subscription expired/invalid (${error.statusCode}): ${sub.endpoint}`);
          db.prepare('UPDATE push_subscriptions SET is_active = 0 WHERE id = ?').run(sub.id);
          failedEndpoints.push(sub.endpoint);
        } else {
          console.error(`[PUSH] Failed to send to device ${sub.device_name}:`, error.message);
          failedEndpoints.push(sub.endpoint);
        }
      }
    }

    console.log(`[PUSH] Sent ${successCount}/${subscriptions.length} notifications to user ${userId}`);

    return {
      success: successCount > 0,
      sentCount: successCount,
      failedCount: failureCount,
      failedEndpoints
    };
  } catch (error) {
    console.error('[PUSH] Error sending push notification:', error.message);
    return { success: false, reason: error.message };
  }
}

/**
 * Get the VAPID public key for client subscription
 */
export function getVapidPublicKey() {
  if (VAPID_PUBLIC_KEY === 'VAPID_PUBLIC_KEY_NOT_SET') {
    return null;
  }
  return VAPID_PUBLIC_KEY;
}

/**
 * Check if push notifications are configured
 */
export function isPushConfigured() {
  return VAPID_PUBLIC_KEY !== 'VAPID_PUBLIC_KEY_NOT_SET' && VAPID_PRIVATE_KEY !== 'VAPID_PRIVATE_KEY_NOT_SET';
}

export default {
  savePushSubscription,
  removePushSubscription,
  getUserSubscriptions,
  sendPushToUser,
  getVapidPublicKey,
  isPushConfigured
};
