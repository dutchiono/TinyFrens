const CACHE='pocket-familiar-v54';
const VIDEOS=['cat','blob','robot'].flatMap(shape=>['purple','cyan','amber','mint','pink','blue'].map(color=>'./pip/'+shape+'-'+color+'.mp4'));
const ASSETS=['./','./index.html','./gallery.html','./style.css','./pet-engine.js','./app.js','./customize.js','./effects.js','./effects.css','./pip.js','./updates.js','./ui.js','./navigation.js','./navigation.css','./vote.html','./vote.js','./visits.js','./push.js','./social-config.js','./friends.js','./party.js','./chat.js','./wallet.js','./nft-discovery.js','./wallet-link.js','./hood-turtles.html','./hood-turtles.js','./featured-turtle.js','./device-sync.js','./companion-identity.js','./turtle-api.js','./gallery.js','./robot-live.mjs','./farcaster.js','./snap.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png',...VIDEOS];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'}))))));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pocket-familiar-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// Web push: the server wakes the phone even when TinyFrens is closed.
self.addEventListener('push',e=>{
 let data={};
 try{data=e.data?e.data.json():{};}catch{data={body:e.data?e.data.text():''};}
 e.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  if(clients.some(c=>c.focused))return; // The app is already open — no nudge needed.
  await self.registration.showNotification(data.title||'TinyFrens',{body:data.body||'A fren reached out 🐾',icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',data:{url:data.url||'./index.html'}});
 })());
});
self.addEventListener('notificationclick',e=>{
 e.notification.close();
 e.waitUntil((async()=>{
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of clients)if('focus' in client)return client.focus();
  return self.clients.openWindow(e.notification.data?.url||'./index.html');
 })());
});
async function videoResponse(request){
 const cached=await caches.match(request.url);
 if(!cached)return fetch(request);
 const range=request.headers.get('Range');if(!range)return cached;
 const bytes=await cached.arrayBuffer(),match=/^bytes=(\d*)-(\d*)$/.exec(range);
 if(!match)return cached;
 let start=match[1]?Number(match[1]):Math.max(0,bytes.byteLength-Number(match[2]));
 let end=match[1]?(match[2]?Math.min(Number(match[2]),bytes.byteLength-1):bytes.byteLength-1):bytes.byteLength-1;
 if(start>end||start>=bytes.byteLength)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+bytes.byteLength}});
 return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Type':'video/mp4','Content-Length':String(end-start+1),'Content-Range':'bytes '+start+'-'+end+'/'+bytes.byteLength,'Accept-Ranges':'bytes'}});
}
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
 if(new URL(e.request.url).pathname.endsWith('.mp4')){e.respondWith(videoResponse(e.request));return;}
 e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok&&r.status===200){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});}return r;}).catch(()=>caches.match(e.request)));
});


