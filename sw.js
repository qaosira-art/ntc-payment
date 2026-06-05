const CACHE_NAME = 'slip-gys-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Basic network-first strategy, required for PWA installability
    event.respondWith(
        fetch(event.request).catch(() => {
            return new Response('Offline');
        })
    );
});
