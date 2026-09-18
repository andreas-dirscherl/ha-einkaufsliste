/**
 * WebSocket Client für Real-Time Sync
 * Verbindet sich mit dem Server und empfängt Live-Updates
 */

export class WebSocketClient {
  constructor(token, userId) {
    this.token = token;
    this.userId = userId;
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.subscribers = new Map(); // eventType → Set<callback>
    this.connectedLists = new Set();
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        // Determine WebSocket URL based on current location
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        console.log('🔗 Connecting to WebSocket:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('✅ WebSocket connected');
          this.reconnectAttempts = 0;

          // Authenticate
          this.send('auth', { token: this.token });

          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('WebSocket message parse error:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('🔌 WebSocket disconnected');
          this.emit('disconnected');
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send message to server
   */
  send(type, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { type, ...data };
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Handle incoming message from server
   */
  handleMessage(message) {
    const { type } = message;

    switch (type) {
      case 'auth':
        if (message.success) {
          console.log('✅ WebSocket authenticated');
          this.emit('authenticated');
        } else {
          console.error('❌ WebSocket auth failed:', message.error);
          this.emit('auth-failed', message.error);
        }
        break;

      case 'subscribed':
        console.log(`👁️ Subscribed to list ${message.listId}`);
        this.connectedLists.add(message.listId);
        this.emit('subscribed', message.listId);
        break;

      case 'item-created':
      case 'item-updated':
      case 'item-deleted':
      case 'list-updated':
        // Real-time sync events
        this.emit('item-change', {
          type: message.type,
          listId: message.listId,
          item: message.item,
          itemId: message.itemId,
          userId: message.userId,
          timestamp: message.timestamp
        });
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  }

  /**
   * Subscribe to a list for real-time updates
   */
  subscribeToList(listId) {
    this.send('subscribe', { listId });
  }

  /**
   * Unsubscribe from a list
   */
  unsubscribeFromList(listId) {
    this.send('unsubscribe', { listId });
    this.connectedLists.delete(listId);
  }

  /**
   * Notify server of an item change (for broadcasting to other clients)
   */
  syncItemChange(listId, action, itemId, item = null) {
    this.send('sync', {
      listId,
      action, // 'create', 'update', 'delete'
      itemId,
      item
    });
  }

  /**
   * Event subscription system
   */
  on(eventType, callback) {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType).add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.get(eventType).delete(callback);
    };
  }

  /**
   * Emit event to subscribers
   */
  emit(eventType, data) {
    if (this.subscribers.has(eventType)) {
      this.subscribers.get(eventType).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event handler for ${eventType}:`, error);
        }
      });
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
      console.log(`🔄 Attempting reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(() => {
        this.connect().catch(err => {
          console.error('Reconnect failed:', err);
        });
      }, delay);
    } else {
      console.error('❌ Max reconnect attempts reached');
      this.emit('reconnect-failed');
    }
  }

  /**
   * Close connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
    }
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export default WebSocketClient;
