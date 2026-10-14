// Network-first: online loads always get the latest deploy; cache is the offline fallback.
const CACHE='tydlig-rt';const ASSETS=['./','index.html','style.css','engine.js','app.js','manifest.json','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(a=>new Request(a,{cache:'reload'})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
e.respondWith(fetch(r,{cache:'no-cache'}).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp));}return res;})
.catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('index.html'))))});
