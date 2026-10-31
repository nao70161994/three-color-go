const CACHE='three-color-go-v1.3';
const CORE=['./','./index.html','./manifest.webmanifest','./icons/app-icon.svg','./icons/icon-192.png','./icons/icon-512.png',
'./src/style.css','./src/game.js','./src/agent.js','./src/strong-ai.js',
'./src/insights.js','./src/online.js','./src/matchmaking.js','./src/ai-worker.js','./src/main.js',
'./play.html'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE)
 .then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),
  self.clients.claim()
])));
self.addEventListener('fetch',event=>{
  const r=event.request,url=new URL(r.url);
  if(r.method!=='GET'||url.origin!==self.location.origin)return;
  if(r.mode==='navigate'){
    event.respondWith(fetch(r).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(r,copy));}
      return response;
    }).catch(()=>caches.match(r).then(v=>v||caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(r,copy));}
    return response;
  })));
});
