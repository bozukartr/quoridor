const CACHE_NAME = 'quoridor-__BUILD_ID__';
const ASSETS = /* __PRECACHE__ */ [];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    // Let an ongoing match finish before an updated worker takes over.
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith('quoridor-') && key !== CACHE_NAME)
            .map(key => caches.delete(key))
    )));
});
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const asset = ASSETS.find(path => new URL(path, self.registration.scope).pathname === url.pathname);
        // Requests for the application root map to the bundled main page.
        const key = asset || (url.pathname === new URL(self.registration.scope).pathname ? './index.html' : null);
        if (key) {
            const cached = await cache.match(new URL(key, self.registration.scope).href);
            if (cached) return cached;
        }
        return fetch(event.request);
    })());
});
