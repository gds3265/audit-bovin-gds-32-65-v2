const CACHE = 'audit-bovin-v14.4';
const ASSETS = ['./?v=14.4','./index.html?v=14.4','./styles.css?v=14.4','./app.js?v=14.4','./cloud-sync.js?v=14.4','./analysis-rules.js','./knowledge-base.js','./storage.js','./utils.js','./manifest.webmanifest?v=14.4','./icon-192.png?v=14.4','./icon-512.png?v=14.4','./planches-visuelles.png','./jszip.min.js?v=14.4','./modele-partenaires-passage-bv.xlsx?v=14.4'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html'))));
});
