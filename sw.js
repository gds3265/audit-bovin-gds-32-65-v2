const CACHE = 'audit-bovin-v14.6.21.2';
const ASSETS = ['./?v=14.6.21.2','./index.html?v=14.6.21.2','./styles.css?v=14.6.21.2','./app.js?v=14.6.21.2','./cloud-sync.js?v=14.6.21.2','./analysis-rules.js','./knowledge-base.js','./storage.js','./utils.js','./manifest.webmanifest?v=14.6.21.2','./icon-192.png?v=14.6.21.2','./icon-512.png?v=14.6.21.2','./planches-visuelles.png','./jszip.min.js?v=14.6.21.2','./modele-partenaires-passage-bv.xlsx?v=14.6.21.2','./questionnaire.html?v=14.6.21.2','./questionnaire.js?v=14.6.21.2','./questionnaire.css?v=14.6.21.2','./memo-aplombs.jpeg','./memo-srr.jpeg','./memo-nec.jpeg','./outil-apera-ph5f.pdf','./outil-control-th.pdf','./outil-extech-ph100.pdf','./outil-extech-re300.pdf','./outil-freestyle-optium.pdf','./outil-hanna-hi701.pdf','./outil-laquatwin-4m.pdf','./outil-lysun-uree.pdf','./outil-multimetre.pdf','./theme-approche-globale.pdf','./theme-eau-abreuvement.pdf','./theme-feces-digestion.pdf','./theme-fourrages-alimentation.pdf','./theme-lait-colostrum-veaux.pdf','./theme-litiere-environnement.pdf','./theme-observation-troupeau.pdf','./theme-outils-prelevements.pdf','./theme-plantes-paturage.pdf','./theme-sang.pdf','./theme-sol.pdf','./theme-urines.pdf'];
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
