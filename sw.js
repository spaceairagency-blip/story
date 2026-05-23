const CACHE_NAME = 'storybridge-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sw.js'
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Caching assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .catch(err => console.log('❌ Cache error:', err))
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external APIs and third-party resources
  if (!url.pathname.startsWith('/') && !request.url.includes(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) {
          console.log('📚 Serving from cache:', request.url);
          return response;
        }

        return fetch(request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type === 'error') {
              return response;
            }

            // Clone the response to cache it
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseToCache);
                console.log('💾 Cached:', request.url);
              })
              .catch(err => console.log('Cache put error:', err));

            return response;
          })
          .catch((err) => {
            console.log('⚠️ Fetch failed:', request.url, err);
            
            // Return offline page if available
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            
            return new Response('Offline - Unable to fetch resource', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
      })
  );
});

// Background Sync - sync data when back online
self.addEventListener('sync', (event) => {
  console.log('🔄 Background sync event:', event.tag);
  
  if (event.tag === 'sync-stories') {
    event.waitUntil(
      syncStories()
        .then(() => console.log('✅ Stories synced'))
        .catch(err => console.log('❌ Sync failed:', err))
    );
  }
});

// Periodic Background Sync - check for new stories
self.addEventListener('periodicsync', (event) => {
  console.log('⏰ Periodic sync event:', event.tag);
  
  if (event.tag === 'update-stories') {
    event.waitUntil(
      updateStories()
        .then(() => console.log('✅ Stories updated'))
        .catch(err => console.log('❌ Update failed:', err))
    );
  }
});

// Push notifications
self.addEventListener('push', (event) => {
  console.log('📬 Push notification received');
  
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || 'New story available!',
      icon: '/favicon.svg',
      badge: '/badge.svg',
      tag: 'story-notification',
      requireInteraction: false,
      actions: [
        {
          action: 'open',
          title: 'Read',
          icon: '/icons/read.svg'
        },
        {
          action: 'close',
          title: 'Close',
          icon: '/icons/close.svg'
        }
      ]
    };

    event.waitUntil(
      self.registration.showNotification('StoryBridge', options)
    );
  }
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('🎯 Notification clicked:', event.action);
  
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Check if app is already open
          for (let i = 0; i < clientList.length; i++) {
            const client = clientList[i];
            if (client.url === '/' && 'focus' in client) {
              return client.focus();
            }
          }
          // Open new window if not open
          if (clients.openWindow) {
            return clients.openWindow('/');
          }
        })
    );
  }
});

// Helper functions
async function syncStories() {
  try {
    const response = await fetch('/api/stories');
    const stories = await response.json();
    
    const db = await openIndexedDB();
    const tx = db.transaction('stories', 'readwrite');
    
    stories.forEach(story => {
      tx.objectStore('stories').put(story);
    });
    
    return tx.complete;
  } catch (err) {
    console.error('Sync error:', err);
    throw err;
  }
}

async function updateStories() {
  try {
    const response = await fetch('/api/stories/latest');
    const newStories = await response.json();
    
    // Notify clients about new stories
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'STORIES_UPDATED',
        data: newStories
      });
    });
  } catch (err) {
    console.error('Update error:', err);
    throw err;
  }
}

async function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('StoryBridgeDB', 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('stories')) {
        db.createObjectStore('stories', { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains('favorites')) {
        db.createObjectStore('favorites', { keyPath: 'id' });
      }
      
      if (!db.objectStoreNames.contains('readingProgress')) {
        db.createObjectStore('readingProgress', { keyPath: 'storyId' });
      }
    };
  });
}

console.log('✅ Service Worker loaded and ready');
