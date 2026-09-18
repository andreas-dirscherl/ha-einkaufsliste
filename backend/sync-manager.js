/**
 * Sync & Conflict Resolution
 * Handles concurrent edits from multiple users
 */

import { getDatabase } from './database.js';

/**
 * Sync Conflict Resolution
 * 
 * Strategie: Last-Write-Wins mit Version Control
 * - Jedes Item hat einen `version` Counter
 * - Bei Konflikt: Höhere Version gewinnt
 * - Bei gleicher Version: Später Timestamp gewinnt
 */

export class SyncManager {
  /**
   * Resolve conflict when two users edit simultaneously
   */
  static resolveConflict(localItem, remoteItem, conflictData) {
    // If versions differ, higher version wins
    if (localItem.version !== remoteItem.version) {
      return localItem.version > remoteItem.version ? localItem : remoteItem;
    }

    // Same version: later timestamp wins (Last-Write-Wins)
    const localTime = new Date(localItem.updated_at).getTime();
    const remoteTime = new Date(remoteItem.updated_at).getTime();

    if (localTime !== remoteTime) {
      return localTime > remoteTime ? localItem : remoteItem;
    }

    // Exact same: return local (doesn't matter, they're identical)
    return localItem;
  }

  /**
   * Merge concurrent changes (optimistic merge)
   * 
   * Szenario: User A und B editieren gleichzeitig
   * - A: Toggle is_completed
   * - B: Change title
   * → Ergebnis: Beide Änderungen kombiniert
   */
  static mergeChanges(originalItem, changeA, changeB) {
    // Start with original
    const merged = { ...originalItem };

    // Apply changes in order (A first, then B)
    // Only apply non-null/non-undefined values

    if (changeA) {
      Object.keys(changeA).forEach(key => {
        if (changeA[key] !== null && changeA[key] !== undefined) {
          merged[key] = changeA[key];
        }
      });
    }

    if (changeB) {
      Object.keys(changeB).forEach(key => {
        if (changeB[key] !== null && changeB[key] !== undefined) {
          merged[key] = changeB[key];
        }
      });
    }

    merged.version = (merged.version || 0) + 1;
    merged.updated_at = new Date().toISOString();

    return merged;
  }

  /**
   * Detect conflicts based on version history
   */
  static hasConflict(localVersion, serverVersion) {
    return localVersion !== serverVersion;
  }

  /**
   * Increment version after successful write
   */
  static incrementVersion(db, itemId) {
    db.prepare(`
      UPDATE items 
      SET version = COALESCE(version, 0) + 1
      WHERE id = ?
    `).run(itemId);
  }

  /**
   * Get full item history for conflict resolution
   */
  static getItemHistory(db, itemId, limit = 10) {
    return db.prepare(`
      SELECT 
        id,
        title,
        is_completed,
        version,
        updated_at,
        ha_synced_at
      FROM items
      WHERE id = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(itemId, limit);
  }
}

/**
 * Push Notifications Manager
 */
export class NotificationManager {
  /**
   * Send notification to user(s)
   */
  static async sendNotification(userId, options) {
    const db = getDatabase();
    
    // Store notification in DB (for future sync)
    db.prepare(`
      INSERT INTO notifications (user_id, title, message, data, type, read)
      VALUES (?, ?, ?, ?, ?, 0)
    `).run(
      userId,
      options.title,
      options.message,
      JSON.stringify(options.data || {}),
      options.type || 'info'
    );

    // Send via Web Push if subscribed
    if (options.sendViaWebPush !== false) {
      await this.sendWebPush(userId, options);
    }
  }

  /**
   * Send Web Push notification
   */
  static async sendWebPush(userId, options) {
    // Implementation requires webpush library
    // For now, this is a placeholder
    console.log(`📧 Push notification to user ${userId}:`, options.title);
  }

  /**
   * Get unread notifications for user
   */
  static getNotifications(db, userId, limit = 20) {
    return db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, limit);
  }

  /**
   * Mark notification as read
   */
  static markAsRead(db, notificationId) {
    db.prepare(`
      UPDATE notifications
      SET read = 1
      WHERE id = ?
    `).run(notificationId);
  }

  /**
   * Get notification summary for UI
   */
  static getNotificationSummary(db, userId) {
    return db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as unread
      FROM notifications
      WHERE user_id = ?
    `).get(userId);
  }
}

export default {
  SyncManager,
  NotificationManager
};
