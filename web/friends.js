'use strict';
(()=>{
 const panel=document.createElement('section');panel.className='friends-panel';panel.id='friendsPanel';
 panel.innerHTML='<h3>Friends</h3><p id="friendsStatus" role="status">Connecting friends…</p><label for="myFriendCode">Your friend code</label><input id="myFriendCode" readonly placeholder="Connect first" spellcheck="false"><button id="copyFriendCode" class="secondary" disabled>Copy my code</button><form id="addFriendForm"><label for="friendCodeInput">Enter a friend’s code</label><input id="friendCodeInput" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" required><button id="addFriendButton" disabled>Add friend</button></form><div id="friendRequests"></div><div id="visitRequests"></div><div id="battleRequests"></div><div id="liveBattle"></div><div id="liveVisit"></div><div id="friendList"></div><p class="small">Friends both accept before visiting. Open TinyFrens on both phones. Visits keep your local save on this device.</p>';
 $('shareVisit').closest('section').append(panel);
 const settings=document.createElement('section');settings.className='overlay';settings.innerHTML='<details><summary>Friends server setup</summary><p>Use the default relay, or connect your own.</p><label for="friendsServer">Server address</label><input id="friendsServer" type="url" placeholder="https://frens.example.com" autocomplete="off"><div class="actions"><button id="connectFriends">Connect</button><button id="disconnectFriends" class="secondary">Disconnect</button></div><p id="serverStatus" role="status"></p><p class="small">Use the same server on both phones. Your private device key stays on this phone. Clearing app data loses your friend code.</p></details>';const advanced=$('advancedSettings');if(advanced)advanced.querySelector('summary').after(settings);else $('settingsPanel').append(settings);
 let ws=null,endpoint='',identity=null,enabled=false,retry=null,delay=1000,visit=null,battle=null,lastProfile='',generation=0,profileTimer=null;
 const notifiedRequests=new Set();
 const listeners=new Set();
 const storage='tinyfrens-live-server';
 function status(text){$('friendsStatus').textContent=text;$('serverStatus').textContent=text;}
 function send(data){if(ws?.readyState!==WebSocket.OPEN){status('Not connected. Try again when you’re online.');return false;}ws.send(JSON.stringify(data));return true;}
 function nativeNotify(title,text){if(native&&typeof PetAndroid.notify==='function'){try{PetAndroid.notify(title,text);}catch{}}}
 function pet(){const s=read();return {name:cleanName(s.name)||'A fren',shape:s.shape==='mascot'?'robot':s.shape==='dog'?'duck':s.shape==='bear'?'pig':['cat','blob','robot','bunny','duck','pig','frog','turtle'].includes(s.shape)?s.shape:'cat',color:/^#[0-9a-f]{6}$/i.test(s.color||'')?s.color:'#a474f1',expression:s.expression||'happy',accessory:s.accessory||'none',tokenId:s.tokenId||null};}
 function sync(){const p=JSON.stringify(pet());if(ws?.readyState===WebSocket.OPEN&&p!==lastProfile){if(send({type:'profile',pet:JSON.parse(p)}))lastProfile=p;}}
 function endVisit(){visit=null;window.TinyFrensVisits.end();$('liveVisit').replaceChildren();$('visitRequests').replaceChildren();}
 function endBattle(){battle=null;$('liveBattle')?.remove();$('battleRequests')?.replaceChildren();if(window.PetAndroid&&typeof window.PetAndroid.endBattle==='function'){try{window.PetAndroid.endBattle();}catch{}}}
 function button(text,handler,secondary=false){const b=document.createElement('button');b.textContent=text;b.className=secondary?'secondary':'';b.onclick=handler;return b;}
 function drawState(data){
  $('myFriendCode').value=data.self.code.slice(0,4)+'-'+data.self.code.slice(4);$('copyFriendCode').disabled=false;$('addFriendButton').disabled=false;
  const requests=$('friendRequests');requests.replaceChildren();
  for(const f of data.requests){if(!notifiedRequests.has(f.id)){notifiedRequests.add(f.id);nativeNotify('TinyFrens friend request',f.pet.name+' wants to be friends.')}const card=document.createElement('div');card.className='friend-card';const p=document.createElement('p');p.textContent=f.pet.name+' wants to be friends.';card.append(p,button('Accept',()=>send({type:'friend-answer',id:f.id,accept:true})),button('Not now',()=>send({type:'friend-answer',id:f.id,accept:false}),true));requests.append(card);}
  const list=$('friendList');list.replaceChildren();
  for(const f of data.friends){const card=document.createElement('div');card.className='friend-card';const name=document.createElement('strong');name.textContent=f.pet.name+' · '+(f.online?'Here now':'Away');const actions=document.createElement('div');actions.className='actions';const b=button('Ask to visit',()=>send({type:'visit-request',id:f.id}));b.disabled=!f.online||Boolean(visit)||Boolean(battle);const sparBtn=button('Spar!',()=>send({type:'battle-request',id:f.id}));sparBtn.disabled=!f.online||Boolean(visit)||Boolean(battle);actions.append(b,sparBtn,button('Remove',()=>send({type:'friend-remove',id:f.id}),true));card.append(name,actions);list.append(card);}
  if(!data.friends.length){const p=document.createElement('p');p.className='small';p.textContent='Swap codes to add your first friend.';list.append(p);}
 }
 function message(data){
  for(const listener of listeners)try{listener(data);}catch{}
  if(data.type==='state'){drawState(data);status('Connected. Friends can say hello.');sync();}
  if(data.type==='notice'||data.type==='error')status(data.text);
  if(data.type==='visit-request'){
   nativeNotify('TinyFrens visit request',data.friend.pet.name+' wants to visit.');
   const requests=$('visitRequests');requests.replaceChildren();const p=document.createElement('p');p.textContent=data.friend.pet.name+' wants to visit.';
   requests.append(p,button('Let them visit',()=>{send({type:'visit-answer',id:data.id,accept:true});requests.replaceChildren();}),button('Not now',()=>{send({type:'visit-answer',id:data.id,accept:false});requests.replaceChildren();},true));status('A friend wants to visit!');window.showScreen('party');requests.scrollIntoView({behavior:'smooth',block:'center'});
  }
  if(data.type==='visit-request-ended'){$('visitRequests').replaceChildren();status('That visit request expired.');}
  if(data.type==='visit-start'){
   visit=data;$('visitRequests').replaceChildren();
   if(data.role==='host'){window.TinyFrensVisits.guest({...data.pet,expires:data.expires},{live:true,onLeave:()=>send({type:'visit-end',id:data.id}),onAction:action=>send({type:'visit-action',id:data.id,action})});window.showScreen('party');$('guestVisit').scrollIntoView({behavior:'smooth',block:'center'});}
   else{const p=document.createElement('p');p.textContent='Your fren is visiting '+data.friend.pet.name+'!';$('liveVisit').replaceChildren(p,button('Wave',()=>send({type:'visit-action',id:data.id,action:'wave'})),button('Dance',()=>send({type:'visit-action',id:data.id,action:'dance'})),button('Come home',()=>send({type:'visit-end',id:data.id}),true));}
   status('Visit started. Say goodbye whenever you like.');
  }
  if(data.type==='visit-profile'&&visit?.id===data.id)window.TinyFrensVisits.update(data.pet);
  if(data.type==='visit-action'&&visit?.id===data.id){window.TinyFrensVisits.animate(data.action);if(visit.role==='visitor')animatePet(data.action);}
  if(data.type==='visit-ended'&&visit?.id===data.id){endVisit();status('Your fren is back home.');}
  if(data.type==='battle-request'){
   nativeNotify('TinyFrens Spar Challenge!',data.friend.pet.name+' wants to spar.');
   const requests=$('battleRequests')||$('visitRequests');requests.replaceChildren();const p=document.createElement('p');p.textContent=data.friend.pet.name+' challenged your fren to a spar!';
   requests.append(p,button('Accept spar!',()=>{send({type:'battle-answer',id:data.id,accept:true});requests.replaceChildren();}),button('Not now',()=>{send({type:'battle-answer',id:data.id,accept:false});requests.replaceChildren();},true));status('A friend wants to spar!');window.showScreen?.('party');requests.scrollIntoView({behavior:'smooth',block:'center'});
  }
  if(data.type==='battle-request-ended'){($('battleRequests')||$('visitRequests')).replaceChildren();status('That spar challenge expired.');}
  if(data.type==='battle-start'){
   battle=data;($('battleRequests')||$('visitRequests')).replaceChildren();
   if(native&&typeof PetAndroid.startBattle==='function'){
    try{PetAndroid.startBattle(JSON.stringify(data.friend.pet),data.role);}catch{}
   }
   runInAppBattle(data);
   status('Spar started! Watch the screen!');
  }
  if(data.type==='battle-action'&&battle?.id===data.id){
   if(typeof animatePet==='function')animatePet('dance');
  }
  if(data.type==='battle-ended'&&battle?.id===data.id){endBattle();status('Spar finished! Joy +15 ✨');}
 }
 function runInAppBattle(data){
  $('liveBattle')?.remove();
  const card=document.createElement('section');card.id='liveBattle';card.className='visit-box battle-arena-card';
  const roleTitle=data.role==='defender'?'Home Turf Defense':'Away Arena Challenge';
  const h2=document.createElement('h2');h2.textContent='Spar with '+data.friend.pet.name+'! ('+roleTitle+')';
  const stage=document.createElement('div');stage.className='guest-stage battle-stage';
  const myPet=pet(),rivalPet=data.friend.pet;
  const leftData=data.role==='challenger'?myPet:rivalPet;
  const rightData=data.role==='challenger'?rivalPet:myPet;
  const leftLabel=data.role==='challenger'?'You (Away)':rivalPet.name+' (Visitor)';
  const rightLabel=data.role==='challenger'?rivalPet.name+' (Home)':'You (Home)';
  const leftWrap=document.createElement('div');leftWrap.className='battle-fren-wrapper battle-left';
  const leftSprite=$('pet').cloneNode(true);leftSprite.removeAttribute('id');
  leftSprite.dataset.shape=leftData.shape==='mascot'?'robot':leftData.shape;leftSprite.dataset.expression=leftData.expression||'happy';leftSprite.dataset.accessory=leftData.accessory||'none';leftSprite.dataset.action='wave';leftSprite.style.setProperty('--pet-color',leftData.color);leftSprite.style.setProperty('--pet-scale','1');
  const leftTag=document.createElement('span');leftTag.className='battle-name-tag';leftTag.textContent=leftLabel;leftWrap.append(leftSprite,leftTag);
  const vsBadge=document.createElement('div');vsBadge.className='battle-vs-badge';vsBadge.textContent='VS';
  const rightWrap=document.createElement('div');rightWrap.className='battle-fren-wrapper battle-right';
  const rightSprite=$('pet').cloneNode(true);rightSprite.removeAttribute('id');
  rightSprite.dataset.shape=rightData.shape==='mascot'?'robot':rightData.shape;rightSprite.dataset.expression=rightData.expression||'happy';rightSprite.dataset.accessory=rightData.accessory||'none';rightSprite.dataset.action='wave';rightSprite.style.setProperty('--pet-color',rightData.color);rightSprite.style.setProperty('--pet-scale','1');
  const rightTag=document.createElement('span');rightTag.className='battle-name-tag';rightTag.textContent=rightLabel;rightWrap.append(rightSprite,rightTag);
  stage.append(leftWrap,vsBadge,rightWrap);
  const statusNote=document.createElement('p');statusNote.className='battle-status-note';statusNote.textContent='Squaring up for a friendly spar…';
  const endBtn=button('Finish spar',()=>{send({type:'battle-end',id:data.id});endBattle();},true);
  card.append(h2,stage,statusNote,endBtn);
  $('friendsPanel').prepend(card);
  card.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>{if(!card.isConnected)return;statusNote.textContent='💥 BOOP! Clash in the center!';leftSprite.dataset.action='dance';rightSprite.dataset.action='dance';},1200);
  setTimeout(()=>{if(!card.isConnected)return;statusNote.textContent='Playful antics and sparks fly!';leftSprite.dataset.action='walk';rightSprite.dataset.action='walk';},2800);
  setTimeout(()=>{
   if(!card.isConnected)return;
   statusNote.textContent='Victory dance! Great spar! Joy +15 ✨';
   leftSprite.dataset.action='dance';rightSprite.dataset.action='wave';
   try{if(typeof act==='function')act('play');else if(window.PetAndroid?.action)window.PetAndroid.action('play');}catch{}
  },4400);
  setTimeout(()=>{if(card.isConnected){statusNote.textContent='Good fightski! Heading home.';setTimeout(()=>{if(card.isConnected)endBattle();},2000);}},7500);
 }
 function normalize(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Use an HTTPS server address, like https://frens.example.com');return u.origin;}
 let registrationId=0;const nativeRegistrations=new Map();
 window.onNativeFriendRegistration=data=>{const pending=nativeRegistrations.get(data.requestId);if(!pending)return;nativeRegistrations.delete(data.requestId);clearTimeout(pending.timer);if(data.result?.error)pending.reject(new Error(data.result.error));else pending.resolve(data.result);};
 async function register(){
  if(window.TinyFrensDesktop?.turtleRequest)return window.TinyFrensDesktop.turtleRequest(endpoint,'/api/register',{pet:pet()});
  if(native&&typeof PetAndroid.registerFriends==='function')return new Promise((resolve,reject)=>{
   const id=++registrationId;const timer=setTimeout(()=>{nativeRegistrations.delete(id);reject(new Error('Friends server took too long. Try again.'));},35000);
   nativeRegistrations.set(id,{resolve,reject,timer});try{PetAndroid.registerFriends(endpoint,JSON.stringify(pet()),id);}catch(e){clearTimeout(timer);nativeRegistrations.delete(id);reject(e);}
  });
  const response=await fetch(endpoint+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pet:pet()}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Server couldn’t create your friend code. Check setup.');return response.json();
 }
 async function connect(){
  const gen=++generation;clearTimeout(retry);const old=ws;ws=null;old?.close();endVisit();endBattle();$('addFriendButton').disabled=true;status('Connecting…');
  try{
   if(!identity){const result=await register();if(!/^[a-f0-9]{32}$/.test(result.id||'')||!/^[-_A-Za-z0-9]{40,100}$/.test(result.token||'')||!/^[-A-Z2-9]{8}$/.test(result.code||''))throw new Error('Friends server response was invalid.');if(gen!==generation)return;identity=result;localStorage.setItem('tinyfrens-device:'+endpoint,JSON.stringify(identity));window.dispatchEvent(new Event('tinyfrens-identity-ready'));}
   if(gen!==generation)return;
   const socket=new WebSocket(endpoint.replace(/^https:/,'wss:')+'/ws');ws=socket;lastProfile='';
   const deadline=setTimeout(()=>{if(socket!==ws)return;ws=null;socket.close();status('Connection timed out. Retrying…');if(enabled)schedule();},20000);
   socket.onopen=()=>{if(socket!==ws)return;socket.send(JSON.stringify({type:'auth',token:identity.token}));};
   socket.onmessage=e=>{if(socket!==ws)return;try{const data=JSON.parse(e.data);if(data.type==='state'){clearTimeout(deadline);delay=1000;}message(data);}catch{status('Server response wasn’t understood.');}};
   socket.onclose=e=>{clearTimeout(deadline);if(socket!==ws)return;ws=null;endVisit();endBattle();$('addFriendButton').disabled=true;for(const b of $('friendList').querySelectorAll('button'))b.disabled=true;status(e.code===4003?'Device connection expired. Reconnect in Settings.':'Disconnected. Reconnecting when possible.');if(enabled&&e.code!==4003&&e.code!==4001)schedule();};
   socket.onerror=()=>status('Can’t reach the server yet. Your fren is still here.');
  }catch(e){if(gen!==generation)return;status(e.message||'Couldn’t connect.');if(enabled)schedule();}
 }
 function schedule(){clearTimeout(retry);retry=setTimeout(()=>{if(enabled)connect();},delay);delay=Math.min(30000,delay*2);}
 $('connectFriends').onclick=()=>{try{endpoint=normalize($('friendsServer').value);localStorage.setItem(storage,endpoint);identity=JSON.parse(localStorage.getItem('tinyfrens-device:'+endpoint)||'null');enabled=true;connect();}catch(e){status(e.message);}};
 $('disconnectFriends').onclick=()=>{enabled=false;++generation;clearTimeout(retry);const old=ws;ws=null;old?.close();endVisit();endBattle();localStorage.removeItem(storage);$('friendList').replaceChildren();$('friendRequests').replaceChildren();$('myFriendCode').value='';$('copyFriendCode').disabled=true;$('addFriendButton').disabled=true;status('Disconnected. Your saved friend code stays on this phone.');};
 $('addFriendForm').onsubmit=e=>{e.preventDefault();const code=$('friendCodeInput').value.replace(/[-\s]/g,'').toUpperCase();if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code)){status('Check the eight letters and numbers in your friend’s code.');return;}if(send({type:'friend-request',code}))$('friendCodeInput').value='';};
 $('copyFriendCode').onclick=async()=>{try{await navigator.clipboard.writeText($('myFriendCode').value);status('Code copied. Send it to someone you know.');}catch{$('myFriendCode').focus();$('myFriendCode').select();status('Select and copy your code above.');}};
 window.addEventListener('pet-profile-changed',()=>{clearTimeout(profileTimer);profileTimer=setTimeout(sync,200);});window.addEventListener('online',()=>{if(enabled&&!ws)connect();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&enabled){if(!ws)connect();else sync();}});
 try{const saved=localStorage.getItem(storage)||window.TINYFRENS_SERVER;if(saved){endpoint=normalize(saved);$('friendsServer').value=endpoint;identity=JSON.parse(localStorage.getItem('tinyfrens-device:'+endpoint)||'null');enabled=true;if(!window.__TINYFRENS_DEFER_AUTH__)connect();else status('Signing you in…');}}catch{status('Could not connect to the friends server. Check the address in Settings.');}
 // Native proximity adapters can call this same code lookup after explicit discovery.
 window.TinyFrensFriends={
  requestByCode:code=>send({type:'friend-request',code}),
  requestBattle:id=>send({type:'battle-request',id}),
  endBattle,
  send,
  on:handler=>{listeners.add(handler);return()=>listeners.delete(handler);},
  pet,
  identity:()=>identity,
  setIdentity:newId=>{identity=newId;if(endpoint)localStorage.setItem('tinyfrens-device:'+endpoint,JSON.stringify(identity));connect();},
  connected:()=>ws?.readyState===WebSocket.OPEN,
  connect:()=>{if(enabled&&!ws)connect();}
 };
})();
