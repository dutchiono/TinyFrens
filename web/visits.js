'use strict';
(()=>{
 const box=document.createElement('section');box.className='visit-box';box.innerHTML='<h2>Friends can visit</h2><p>Send a little hello to someone you know. They choose whether to let your fren visit.</p><button id="shareVisit">Send a visit invite</button><input id="visitLink" readonly aria-label="Visit invite link" hidden><p id="visitStatus" role="status"></p><p class="small">Invites share your pet’s name and look for 30 minutes. Your pet stays here. Bluetooth discovery is not included yet.</p>';
 $('screen-pet').append(box);
 function decode(value){
  if(!value||value.length>1600)throw new Error('Invalid invite');
  const bytes=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const data=JSON.parse(new TextDecoder().decode(bytes));
  const validShapes=['cat','blob','robot','bunny','duck','pig','frog','turtle','dog','bear','mascot'];
  if(data.v!==1||!validShapes.includes(data.shape)||!/^#[0-9a-f]{6}$/i.test(data.color)||!Number.isFinite(data.expires)||data.expires<Date.now()||data.expires>Date.now()+31*60*1000)throw new Error('Expired invite');
  const normShape = data.shape==='mascot'?'robot':data.shape==='dog'?'duck':data.shape==='bear'?'pig':data.shape;
  return {name:cleanName(data.name)||'A fren',shape:normShape,color:data.color,expression:data.expression||'happy',accessory:data.accessory||'none',tokenId:data.tokenId||null,expires:data.expires,v:1};
 }
 function guest(data,options={}){
  if(data.shape==='mascot')data={...data,shape:'robot'};
  $('guestVisit')?.remove();
  const card=document.createElement('section');card.id='guestVisit';card.className='visit-box';
  const title=document.createElement('h2');title.textContent=data.name+(data.tokenId?' (#'+data.tokenId+')':'')+' is visiting!';
  const stage=document.createElement('div');stage.className='guest-stage';
  const sprite=$('pet').cloneNode(true);sprite.removeAttribute('id');sprite.dataset.shape=data.shape;sprite.dataset.expression=data.expression||'happy';sprite.dataset.accessory=data.accessory||'none';sprite.dataset.action='wave';sprite.style.setProperty('--pet-color',data.color);sprite.style.setProperty('--pet-scale','1');stage.append(sprite);
  const note=document.createElement('p');note.textContent='A little hello from a friend. Your own pet and save stay here.';
  const leave=document.createElement('button');leave.className='secondary';leave.textContent='Say goodbye';leave.onclick=()=>{card.remove();try{sessionStorage.removeItem('tinyfrens-guest');}catch{}};
  card.append(title,stage,note,leave);box.before(card);
  if(options.live)try{sessionStorage.removeItem('tinyfrens-guest');}catch{}
  if(!options.live)try{sessionStorage.setItem('tinyfrens-guest',JSON.stringify(data));}catch{}
  leave.addEventListener('click',()=>options.onLeave?.());
  if(options.live){for(const action of ['wave','dance']){const button=document.createElement('button');button.textContent=action==='wave'?'Wave':'Dance';button.onclick=()=>options.onAction?.(action);card.insertBefore(button,leave);}}
  setTimeout(()=>{if(card.isConnected)leave.click();},Math.max(0,data.expires-Date.now()));
 }
 window.TinyFrensVisits={guest,end:()=>$('guestVisit')?.remove(),update:data=>{const card=$('guestVisit');if(!card)return;card.querySelector('h2').textContent=data.name+(data.tokenId?' (#'+data.tokenId+')':'')+' is visiting!';const sprite=card.querySelector('.guest-stage > div');if(sprite){sprite.dataset.shape=data.shape==='mascot'?'robot':data.shape;sprite.style.setProperty('--pet-color',data.color);if(data.expression)sprite.dataset.expression=data.expression;if(data.accessory)sprite.dataset.accessory=data.accessory;}},animate:action=>{const sprite=$('guestVisit')?.querySelector('.guest-stage > div');if(sprite)sprite.dataset.action=action;}};
 const incoming=new URLSearchParams(location.search).get('guest');
 if(incoming){
  try{
   const data=decode(incoming);const invite=document.createElement('section');invite.id='visitInvite';invite.className='visit-box';
   const title=document.createElement('h2');title.textContent=data.name+(data.tokenId?' (#'+data.tokenId+')':'')+' wants to visit';
   const yes=document.createElement('button');yes.textContent='Let them visit';yes.onclick=()=>{invite.remove();guest(data);};
   const no=document.createElement('button');no.textContent='Not now';no.className='secondary';no.onclick=()=>invite.remove();
   const actions=document.createElement('div');actions.className='actions';actions.append(yes,no);invite.append(title,actions);$('screen-pet').prepend(invite);
  }catch{$('visitStatus').textContent='This invite has expired or doesn’t look right. Ask for a new one.';}
 }else{
  try{const saved=sessionStorage.getItem('tinyfrens-guest');if(saved){const data=JSON.parse(saved);if(data.expires>Date.now())guest(data);else sessionStorage.removeItem('tinyfrens-guest');}}catch{}
 }
 $('shareVisit').onclick=async()=>{
  const s=read(),data={v:1,name:cleanName(s.name),shape:s.shape==='mascot'?'robot':s.shape==='dog'?'duck':s.shape==='bear'?'pig':['cat','blob','robot','bunny','duck','pig','frog','turtle'].includes(s.shape)?s.shape:'cat',color:/^#[0-9a-f]{6}$/i.test(s.color||'')?s.color:'#a474f1',expression:s.expression||'happy',accessory:s.accessory||'none',tokenId:s.tokenId||null,expires:Date.now()+30*60*1000};
  const encoded=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(data)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const url='https://tinyfrens.lol/web/?guest='+encoded;
  try{
   if(native&&typeof PetAndroid.shareVisit==='function'){PetAndroid.shareVisit(url);return;}
   if(window.PetIOS){window.webkit.messageHandlers.petUpdates.postMessage({type:'share',url});return;}
   if(navigator.share){await navigator.share({title:'A TinyFrens visit',text:data.name+' wants to say hello!',url});return;}
   await navigator.clipboard.writeText(url);$('visitStatus').textContent='Invite copied. Send it to your friend.';
  }catch(e){if(e.name==='AbortError')return;$('visitLink').hidden=false;$('visitLink').value=url;$('visitLink').focus();$('visitLink').select();$('visitStatus').textContent='Copy this link and send it to your friend.';}
 };
})();

