const CACHE='three-color-go-v1.5';
const CORE=['./','./index.html','./manifest.webmanifest','./icons/app-icon.svg',
'./icons/icon-192.png','./icons/icon-512.png','./src/style.css',
'./src/game.js','./src/agent.js','./src/strong-ai.js','./src/neural-weights.js','./src/neural-ai.js','./src/insights.js',
'./src/online.js','./src/matchmaking.js','./src/ai-worker.js','./src/main.js',
'./play.html','./match-config.js'];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
  self.clients.claim()
])));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  // Network-first keeps deployed game code fresh, with offline cache fallback.
  event.respondWith(fetch(request).then(response=>{
    if(response.ok){
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(request,copy)));
    }
    return response;
  }).catch(()=>caches.match(request).then(hit=>hit||
    (request.mode==='navigate'?caches.match('./index.html'):Response.error()))));
});
