const CACHE = 'audit-bovin-v14.5.5';
const ASSETS = ['./?v=14.5.5','./index.html?v=14.5.5','./styles.css?v=14.5.5','./app.js?v=14.5.5','./cloud-sync.js?v=14.5.5','./analysis-rules.js','./knowledge-base.js','./storage.js','./utils.js','./manifest.webmanifest?v=14.5.5','./icon-192.png?v=14.5.5','./icon-512.png?v=14.5.5','./planches-visuelles.png','./jszip.min.js?v=14.5.5','./modele-partenaires-passage-bv.xlsx?v=14.5.5'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    if (!response || !response.ok) throw new Error('Réponse réseau invalide');
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html'))));
});
