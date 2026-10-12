'use strict';
(()=>{
 // Web push opt-in (Settings → Notifications). Works in browsers and installed PWAs;
 // native Android/iOS wrappers and embedded mini-apps use their own channels instead.
 const server=()=>{try{return String(localStorage.getItem('tinyfrens-live-server')||window.TINYFRENS_SERVER||'').replace(/\/+$/,'');}catch{return'';}};
 const identity=()=>{try{const ep=server();return ep?JSON.parse(localStorage.getItem('tinyfrens-device:'+ep)||'null'):null;}catch{return null;}};
 const embedded=window.self!==window.top||Boolean(window.farcaster)||Boolean(window.Telegram?.WebApp);
 if(desktop||native||window.PetIOS||embedded)return;
 const iOS=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=window.navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches;
 const section=document.createElement('section');section.className='overlay';section.id='notifySection';
 section.innerHTML='<h2>Notifications</h2><p id="notifyStatus" role="status">Get a nudge when a fren reaches out.</p><label class="toggle"><span>Notify me when a fren reaches out</span><input id="notifyToggle" type="checkbox"></label><p class="small"></p>';
 $('settingsPanel').append(section);
 const status=text=>{$('notifyStatus').textContent=text;};
 if(!('serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window)){
  if(iOS&&!standalone){status('Add TinyFrens to your Home Screen to get notifications. Safari → Share → Add to Home Screen (iOS 16.4+).');$('notifyToggle').disabled=true;return;}
  section.hidden=true;return;
 }
 const pref='tinyfrens-push';
 const saved=()=>{try{return JSON.parse(localStorage.getItem(pref)||'null');}catch{return null;}};
 const save=v=>{try{v?localStorage.setItem(pref,JSON.stringify(v)):localStorage.removeItem(pref);}catch{}};
 const bytes=key=>{const pad=key.replace(/-/g,'+').replace(/_/g,'/'),raw=atob(pad+'='.repeat((4-pad.length%4)%4)),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;};
 async function key(ep){
  const response=await fetch(ep+'/api/push/public-key',{headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error('This server doesn’t offer notifications yet.');
  const data=await response.json();
  if(!/^[A-Za-z0-9_-]{40,300}$/.test(data.key||''))throw new Error('Notifications aren’t set up on this server yet.');
  return data.key;
 }
 async function subscribe(){
  const ep=server(),id=identity();
  if(!ep||!id)throw new Error('Connect the friends server first (Friends server setup above).');
  if((await Notification.requestPermission())!=='granted')throw new Error('Notifications are blocked in your browser settings.');
  const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(await key(ep))});
  const response=await fetch(ep+'/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:id.token,subscription:subscription.toJSON()})});
  if(!response.ok)throw new Error('The server said no. Try again in a moment.');
  save({endpoint:ep});
  status('On. You’ll hear from us when a fren sends a request or visits.');
 }
 async function unsubscribe(){
  const ep=saved()?.endpoint||server(),id=identity();
  const registration=await navigator.serviceWorker.getRegistration();
  const subscription=await registration?.pushManager.getSubscription();
  if(subscription){await subscription.unsubscribe().catch(()=>{});if(id&&ep)fetch(ep+'/api/push/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:id.token,endpoint:subscription.endpoint})}).catch(()=>{});}
  save(null);
  status('Off. Tap any time to hear from your frens again.');
 }
 $('notifyToggle').onchange=async()=>{
  const toggle=$('notifyToggle');
  toggle.disabled=true;
  try{
   if(toggle.checked)await subscribe();
   else await unsubscribe();
  }catch(e){status(e.message||'Couldn’t set that up right now.');}
  toggle.checked=!!saved();
  toggle.disabled=false;
 };
 if(saved()&&saved().endpoint===server()){
  $('notifyToggle').checked=true;
  // Quietly refresh the stored subscription; keys and endpoints can rotate.
  subscribe().catch(()=>{save(null);$('notifyToggle').checked=false;status('Notifications need setting up again. Tap the toggle to re-enable.');});
 }else status('Get a nudge when a fren sends a request while you’re away. Notifications stay off until you tap.');
})();