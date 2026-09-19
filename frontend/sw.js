const CACHE_NAME = 'einkaufsliste-v1';
const OFFLINE_DB = 'einkaufsliste-offline';
const API_CACHE = 'einkaufsliste-api-v1';

// Cache version for automatic updates
// This gets updated on each deployment
const CACHE_VERSION = Date.now();

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/setup.html',
  '/manifest.json',
  'https://cdn.tailwindcss.com'
];

/**
 * Install Service Worker
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker, cache version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching app shell');
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  // Immediately claim all clients (activate without waiting)
  self.skipWaiting();
});

/**
 * Fetch event - Network first, then cache
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: Try network first, cache as fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Static assets: Cache first, network fallback
  event.respondWith(
    caches.match(request).then((response) => {
      if (response) return response;

      return fetch(request).then((response) => {
        // Cache successful responses
        if (response && response.status === 200 && request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // Return offline page for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

/**
 * Handle API requests with offline queueing
 */
async function handleApiRequest(request) {
  try {
    const response = await fetch(request.clone());
    
    // Cache successful API responses
    if (response.ok) {
      const responseClone = response.clone();
      const cache = await caches.open(API_CACHE);
      cache.put(request, responseClone);
    }
    
    return response;
  } catch (error) {
    // Offline: Return cached response or queue the request
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Queue the request for later sync
    if (request.method !== 'GET') {
      await queueOfflineRequest(request);
    }

    return new Response(
      JSON.stringify({ error: 'Offline - Request will be synced later' }),
      { 
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Queue offline requests for background sync
 */
async function queueOfflineRequest(request) {
  const db = await openOfflineDB();
  const body = request.method !== 'GET' ? await request.text() : null;

  const offlineRequest = {
    id: `${Date.now()}_${Math.random()}`,
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body: body,
    timestamp: Date.now()
  };

  await db.add('pending-requests', offlineRequest);
  console.log('Offline request queued:', offlineRequest);
  
  // Register background sync to process offline requests when online
  if ('serviceWorkerContainer' in navigator) {
    try {
      const registration = await self.registration;
      if ('sync' in registration) {
        await registration.sync.register('sync-offline-requests');
        console.log('Background sync registered');
      }
    } catch (error) {
      console.log('Background sync not available:', error);
    }
  }
}

/**
 * Open IndexedDB for offline queue
 */
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      resolve(db.transaction('pending-requests', 'readwrite').objectStore('pending-requests'));
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending-requests')) {
        db.createObjectStore('pending-requests', { keyPath: 'id' });
      }
    };
  });
}

/**
 * Background sync - Sync queued requests when online
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-requests') {
    event.waitUntil(syncOfflineRequests());
  }
});

/**
 * Sync pending offline requests
 */
async function syncOfflineRequests() {
  try {
    const db = await openOfflineDB();
    const requests = await getAllFromStore(db);

    for (const offlineRequest of requests) {
      try {
        const response = await fetch(offlineRequest.url, {
          method: offlineRequest.method,
          headers: offlineRequest.headers,
          body: offlineRequest.body
        });

        if (response.ok) {
          // Remove from queue
          await removeFromStore(db, offlineRequest.id);
          console.log('Synced offline request:', offlineRequest.id);
        }
      } catch (error) {
        console.log('Failed to sync request:', offlineRequest.id, error);
        // Will retry on next sync
      }
    }
  } catch (error) {
    console.error('Sync failed:', error);
  }
}

/**
 * Helper: Get all items from IndexedDB store
 */
function getAllFromStore(objectStore) {
  return new Promise((resolve, reject) => {
    const request = objectStore.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Helper: Remove item from IndexedDB store
 */
function removeFromStore(objectStore, key) {
  return new Promise((resolve, reject) => {
    const request = objectStore.delete(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Handle messages from client
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Received SKIP_WAITING message');
    self.skipWaiting();
  }
  
  // Handle push notifications from client
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    self.registration.showNotification(event.data.title, event.data.options);
  }
});

/**
 * Activate Service Worker - Claim all clients immediately
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker, version:', CACHE_VERSION);
  event.waitUntil(
    // Clean up old caches
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Keep only current cache version
          if (cacheName !== CACHE_NAME && cacheName !== API_CACHE) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Claim all clients immediately - don't wait
      console.log('[SW] Claiming all clients');
      return self.clients.claim();
    })
  );
});
