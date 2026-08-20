const CACHE = 'audit-bovin-pwa-v14.6.21.39';
const ASSETS = [
  './?v=14.6.21.39','./index.html?v=14.6.21.39','./styles.css?v=14.6.21.39','./app.js?v=14.6.21.39','./cloud-sync.js?v=14.6.21.39',
  './analysis-rules.js','./knowledge-base.js','./storage.js','./utils.js','./manifest.webmanifest?v=14.6.21.39',
  './icon-192.png?v=14.6.21.39','./icon-512.png?v=14.6.21.39','./planches-visuelles.png','./jszip.min.js?v=14.6.21.39',
  './modele-partenaires-passage-bv.xlsx?v=14.6.21.39','./questionnaire.html?v=14.6.21.39','./questionnaire.js?v=14.6.21.39','./questionnaire.css?v=14.6.21.39',
  './memo-aplombs.jpeg','./memo-srr.jpeg','./memo-nec.jpeg','./outil-apera-ph5f.pdf','./outil-control-th.pdf','./outil-extech-ph100.pdf','./outil-extech-re300.pdf',
  './outil-freestyle-optium.pdf','./outil-hanna-hi701.pdf','./outil-laquatwin-4m.pdf','./outil-lysun-uree.pdf','./outil-multimetre.pdf',
  './theme-approche-globale.pdf','./theme-eau-abreuvement.pdf','./theme-feces-digestion.pdf','./theme-fourrages-alimentation.pdf','./theme-lait-colostrum-veaux.pdf',
  './theme-litiere-environnement.pdf','./theme-observation-troupeau.pdf','./theme-outils-prelevements.pdf','./theme-plantes-paturage.pdf','./theme-sang.pdf','./theme-sol.pdf',
  './theme-urines.pdf','./theme-hydratation-ruminants.pdf','./reference-climalim-hydratation-2026.pdf'
];
self.addEventListener('install', event => event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.all(ASSETS.map(async url=>{
    try{const r=await fetch(url,{cache:'reload'});if(r&&r.ok)await cache.put(url,r.clone());}catch(_){/* ressource optionnelle absente : ne bloque pas l'installation */}
  }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('audit-bovin-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET')return;
  const req=event.request;
  event.respondWith((async()=>{
    try{
      const response=await fetch(req);
      if(response&&response.ok){const cache=await caches.open(CACHE);cache.put(req,response.clone()).catch(()=>{});}
      return response;
    }catch(_){
      const hit=await caches.match(req);if(hit)return hit;
      if(req.mode==='navigate')return (await caches.match('./index.html?v=14.6.21.39'))||(await caches.match('./?v=14.6.21.39'))||(await caches.match('./index.html'));
      return Response.error();
    }
  })());
});
