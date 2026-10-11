'use strict';
(()=>{
 const panel=document.createElement('section');panel.className='friends-panel';panel.id='friendsPanel';
 panel.innerHTML='<h3>Friends</h3><p id="friendsStatus" role="status">Friends will be ready when your grown-up connects the server.</p><label for="myFriendCode">Your friend code</label><input id="myFriendCode" readonly placeholder="Connect first" spellcheck="false"><button id="copyFriendCode" class="secondary" disabled>Copy my code</button><form id="addFriendForm"><label for="friendCodeInput">Enter a friend’s code</label><input id="friendCodeInput" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" required><button id="addFriendButton" disabled>Add friend</button></form><div id="friendRequests"></div><div id="visitRequests"></div><div id="liveVisit"></div><div id="friendList"></div><p class="small">Friends both accept before visiting. Open TinyFrens on both phones. Your own pet stays safe. No chat or location sharing.</p>';
 $('shareVisit').closest('section').append(panel);
 const settings=document.createElement('section');settings.className='overlay';settings.innerHTML='<details><summary>Friends server setup</summary><p>Ask a grown-up to set up the server first.</p><label for="friendsServer">Server address</label><input id="friendsServer" type="url" placeholder="https://pets.example.com" autocomplete="off"><div class="actions"><button id="connectFriends">Connect</button><button id="disconnectFriends" class="secondary">Disconnect</button></div><p id="serverStatus" role="status"></p><p class="small">Use the same server on both phones. Your private device key stays on this phone. Clearing app data loses your friend code.</p></details>';$('settingsPanel').append(settings);
 let ws=null,endpoint='',identity=null,enabled=false,retry=null,delay=1000,visit=null,lastProfile='',generation=0,profileTimer=null;
 const listeners=new Set();
 const storage='tinyfrens-live-server';
 function status(text){$('friendsStatus').textContent=text;$('serverStatus').textContent=text;}
 function send(data){if(ws?.readyState!==WebSocket.OPEN){status('Not connected. Try again when you’re online.');return false;}ws.send(JSON.stringify(data));return true;}
 function pet(){const s=read();return {name:cleanName(s.name)||'A fren',shape:s.shape==='mascot'?'robot':['cat','blob','robot','bunny','dog','bear','frog','turtle'].includes(s.shape)?s.shape:'cat',color:/^#[0-9a-f]{6}$/i.test(s.color||'')?s.color:'#a474f1',expression:s.expression||'happy',accessory:s.accessory||'none',tokenId:s.tokenId||null};}
 function sync(){const p=JSON.stringify(pet());if(ws?.readyState===WebSocket.OPEN&&p!==lastProfile){if(send({type:'profile',pet:JSON.parse(p)}))lastProfile=p;}}
 function endVisit(){visit=null;window.TinyFrensVisits.end();$('liveVisit').replaceChildren();$('visitRequests').replaceChildren();}
 function button(text,handler,secondary=false){const b=document.createElement('button');b.textContent=text;b.className=secondary?'secondary':'';b.onclick=handler;return b;}
 function drawState(data){
  $('myFriendCode').value=data.self.code.slice(0,4)+'-'+data.self.code.slice(4);$('copyFriendCode').disabled=false;$('addFriendButton').disabled=false;
  const requests=$('friendRequests');requests.replaceChildren();
  for(const f of data.requests){const card=document.createElement('div');card.className='friend-card';const p=document.createElement('p');p.textContent=f.pet.name+' wants to be friends.';card.append(p,button('Accept',()=>send({type:'friend-answer',id:f.id,accept:true})),button('Not now',()=>send({type:'friend-answer',id:f.id,accept:false}),true));requests.append(card);}
  const list=$('friendList');list.replaceChildren();
  for(const f of data.friends){const card=document.createElement('div');card.className='friend-card';const name=document.createElement('strong');name.textContent=f.pet.name+' · '+(f.online?'Here now':'Away');const actions=document.createElement('div');actions.className='actions';const b=button('Ask to visit',()=>send({type:'visit-request',id:f.id}));b.disabled=!f.online||Boolean(visit);actions.append(b,button('Remove',()=>send({type:'friend-remove',id:f.id}),true));card.append(name,actions);list.append(card);}
  if(!data.friends.length){const p=document.createElement('p');p.className='small';p.textContent='Swap codes to add your first friend.';list.append(p);}
 }
 function message(data){
  for(const listener of listeners)try{listener(data);}catch{}
  if(data.type==='state'){drawState(data);status('Connected. Friends can say hello.');sync();}
  if(data.type==='notice'||data.type==='error')status(data.text);
  if(data.type==='visit-request'){
   const requests=$('visitRequests');requests.replaceChildren();const p=document.createElement('p');p.textContent=data.friend.pet.name+' wants to visit.';
   requests.append(p,button('Let them visit',()=>{send({type:'visit-answer',id:data.id,accept:true});requests.replaceChildren();}),button('Not now',()=>{send({type:'visit-answer',id:data.id,accept:false});requests.replaceChildren();},true));status('A friend wants to visit!');window.showScreen('pet');requests.scrollIntoView({behavior:'smooth',block:'center'});
  }
  if(data.type==='visit-request-ended'){$('visitRequests').replaceChildren();status('That visit request expired.');}
  if(data.type==='visit-start'){
   visit=data;$('visitRequests').replaceChildren();
   if(data.role==='host'){window.TinyFrensVisits.guest({...data.pet,expires:data.expires},{live:true,onLeave:()=>send({type:'visit-end',id:data.id}),onAction:action=>send({type:'visit-action',id:data.id,action})});window.showScreen('pet');$('guestVisit').scrollIntoView({behavior:'smooth',block:'center'});}
   else{const p=document.createElement('p');p.textContent='Your fren is visiting '+data.friend.pet.name+'!';$('liveVisit').replaceChildren(p,button('Wave',()=>send({type:'visit-action',id:data.id,action:'wave'})),button('Dance',()=>send({type:'visit-action',id:data.id,action:'dance'})),button('Come home',()=>send({type:'visit-end',id:data.id}),true));}
   status('Visit started. Say goodbye whenever you like.');
  }
  if(data.type==='visit-profile'&&visit?.id===data.id)window.TinyFrensVisits.update(data.pet);
  if(data.type==='visit-action'&&visit?.id===data.id){window.TinyFrensVisits.animate(data.action);if(visit.role==='visitor')animatePet(data.action);}
  if(data.type==='visit-ended'&&visit?.id===data.id){endVisit();status('Your fren is back home.');}
 }
 function normalize(raw){const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Use an HTTPS server address, like https://pets.example.com');return u.origin;}
 let registrationId=0;const nativeRegistrations=new Map();
 window.onNativeFriendRegistration=data=>{const pending=nativeRegistrations.get(data.requestId);if(!pending)return;nativeRegistrations.delete(data.requestId);clearTimeout(pending.timer);if(data.result?.error)pending.reject(new Error(data.result.error));else pending.resolve(data.result);};
 async function register(){
  if(native&&typeof PetAndroid.registerFriends==='function')return new Promise((resolve,reject)=>{
   const id=++registrationId;const timer=setTimeout(()=>{nativeRegistrations.delete(id);reject(new Error('Friends server took too long. Try again.'));},35000);
   nativeRegistrations.set(id,{resolve,reject,timer});try{PetAndroid.registerFriends(endpoint,JSON.stringify(pet()),id);}catch(e){clearTimeout(timer);nativeRegistrations.delete(id);reject(e);}
  });
  const response=await fetch(endpoint+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pet:pet()}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Server couldn’t create your friend code. Check setup.');return response.json();
 }
 async function connect(){
  const gen=++generation;clearTimeout(retry);const old=ws;ws=null;old?.close();endVisit();$('addFriendButton').disabled=true;status('Connecting…');
  try{
   if(!identity){const result=await register();if(!/^[a-f0-9]{32}$/.test(result.id||'')||!/^[-_A-Za-z0-9]{40,100}$/.test(result.token||'')||!/^[-A-Z2-9]{8}$/.test(result.code||''))throw new Error('Friends server response was invalid.');if(gen!==generation)return;identity=result;localStorage.setItem('tinyfrens-device:'+endpoint,JSON.stringify(identity));}
   if(gen!==generation)return;
   const socket=new WebSocket(endpoint.replace(/^https:/,'wss:')+'/ws');ws=socket;lastProfile='';
   socket.onopen=()=>{delay=1000;socket.send(JSON.stringify({type:'auth',token:identity.token}));};
   socket.onmessage=e=>{if(socket!==ws)return;try{message(JSON.parse(e.data));}catch{status('Server response wasn’t understood.');}};
   socket.onclose=e=>{if(socket!==ws)return;ws=null;endVisit();$('addFriendButton').disabled=true;for(const b of $('friendList').querySelectorAll('button'))b.disabled=true;status(e.code===4003?'Device key not recognized. Ask a grown-up to check the server.':'Disconnected. Reconnecting when possible.');if(enabled&&e.code!==4003&&e.code!==4001)schedule();};
   socket.onerror=()=>status('Can’t reach the server yet. Your pet is still here.');
  }catch(e){if(gen!==generation)return;status(e.message||'Couldn’t connect.');if(enabled)schedule();}
 }
 function schedule(){clearTimeout(retry);retry=setTimeout(()=>{if(enabled)connect();},delay);delay=Math.min(30000,delay*2);}
 $('connectFriends').onclick=()=>{try{endpoint=normalize($('friendsServer').value);localStorage.setItem(storage,endpoint);identity=JSON.parse(localStorage.getItem('tinyfrens-device:'+endpoint)||'null');enabled=true;connect();}catch(e){status(e.message);}};
 $('disconnectFriends').onclick=()=>{enabled=false;++generation;clearTimeout(retry);const old=ws;ws=null;old?.close();endVisit();localStorage.removeItem(storage);$('friendList').replaceChildren();$('friendRequests').replaceChildren();$('myFriendCode').value='';$('copyFriendCode').disabled=true;$('addFriendButton').disabled=true;status('Disconnected. Your saved friend code stays on this phone.');};
 $('addFriendForm').onsubmit=e=>{e.preventDefault();const code=$('friendCodeInput').value.replace(/[-\s]/g,'').toUpperCase();if(!/^[A-HJ-NP-Z2-9]{8}$/.test(code)){status('Check the eight letters and numbers in your friend’s code.');return;}if(send({type:'friend-request',code}))$('friendCodeInput').value='';};
 $('copyFriendCode').onclick=async()=>{try{await navigator.clipboard.writeText($('myFriendCode').value);status('Code copied. Send it to someone you know.');}catch{$('myFriendCode').focus();$('myFriendCode').select();status('Select and copy your code above.');}};
 window.addEventListener('pet-profile-changed',()=>{clearTimeout(profileTimer);profileTimer=setTimeout(sync,200);});window.addEventListener('online',()=>{if(enabled&&!ws)connect();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&enabled){if(!ws)connect();else sync();}});
 try{const saved=localStorage.getItem(storage)||window.TINYFRENS_SERVER;if(saved){endpoint=normalize(saved);$('friendsServer').value=endpoint;identity=JSON.parse(localStorage.getItem('tinyfrens-device:'+endpoint)||'null');enabled=true;connect();}}catch{status('Ask a grown-up to check the server address.');}
 // Native proximity adapters can call this same code lookup after explicit discovery.
 window.TinyFrensFriends={
  requestByCode:code=>send({type:'friend-request',code}),
  send,
  on:handler=>{listeners.add(handler);return()=>listeners.delete(handler);},
  pet,
  identity:()=>identity,
  connected:()=>ws?.readyState===WebSocket.OPEN,
  connect:()=>{if(enabled&&!ws)connect();}
 };
})();
