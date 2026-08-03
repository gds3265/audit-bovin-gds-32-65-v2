const CACHE = 'audit-bovin-v11.11.1';
const ASSETS = ['./?v=11.11.1','./index.html?v=11.11.1','./styles.css?v=11.11.1','./app.js?v=11.11.1','./analysis-rules.js','./knowledge-base.js','./storage.js','./utils.js','./manifest.webmanifest?v=11.11.1','./icon-192.png?v=11.11.1','./icon-512.png?v=11.11.1','./planches-visuelles.png','./jszip.min.js?v=11.11.1','./modele-partenaires-passage-bv.xlsx?v=11.11.1'];
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
