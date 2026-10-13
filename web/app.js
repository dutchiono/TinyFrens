'use strict';
const native = typeof window.PetAndroid !== 'undefined';
const desktop = window.TinyFrensDesktop;
// Frameless Windows builds use the app header as the window title bar (drag region + caption-button space).
try { if (desktop && JSON.parse(desktop.getState()).frameless) document.documentElement.classList.add('desktop-titlebar'); } catch {}
const key = 'pocket-familiar-v1';
const $ = id => document.getElementById(id);
const Engine = window.TinyFrensEngine;
function initial(){return Engine.save(Engine.normalize({mode:'roam'},Date.now()));}
function localRaw(){
  let s; try{s=JSON.parse(localStorage.getItem(key)) || initial();}catch{s=initial();}
  return s && typeof s === 'object' ? s : initial();
}
function localBridge(method,arg){
  const out=JSON.parse(Engine.bridge(method,JSON.stringify(localRaw()),JSON.stringify(arg ?? null),Date.now()));
  localStorage.setItem(key,JSON.stringify(out.state));
  if(out.feedback!==undefined)out.view.feedback=out.feedback;
  if(out.blocked!==undefined)out.view.blocked=out.blocked;
  if(out.animation!==undefined)out.view.animation=out.animation;
  return out.view;
}
function localRead(){
  return localBridge('read');
}
function read(){return desktop?JSON.parse(desktop.getState()):native?JSON.parse(PetAndroid.getState()):localRead();}
const NAMES=Engine.NAMES;
function cleanName(n){return Engine.cleanName(n);}
function randomName(shape,avoid){
  return Engine.randomName(Engine.normalShape(shape),avoid);
}
function rename(n){
  const name=cleanName(n);
  if(desktop)return JSON.parse(desktop.rename(name));
  if(native)return JSON.parse(PetAndroid.rename(name));
  return localBridge('rename',name);
}
function ensureName(s){return s.name?s:rename(randomName(s.shape));}
function action(name){
  if(desktop)return JSON.parse(desktop.action(name));
  if(native)return JSON.parse(PetAndroid.action(name));
  return localBridge('act',name);
}
// Games share the existing engine and native persistence instead of editing stats.
window.TinyFrensGameCare = {
  canPlay: () => Engine.act(read(), 'play', Date.now()),
  complete: () => { const state = action('play'); render(state); return state; }
};
function render(s){
  const stage=Number(s.stage)||0;
  $('pet').dataset.stage=String(stage);
  if(s.shape) $('pet').dataset.shape=s.shape==='mascot'?'robot':s.shape;
  $('pet').dataset.expression = s.expression || 'happy';
  $('pet').dataset.accessory = s.accessory || 'none';
  if(s.color) $('pet').style.setProperty('--pet-color',s.color);
  if(s.size) $('pet').style.setProperty('--pet-scale',String((s.size||80)/80));
  $('stageText').textContent=s.stageName||['Hatchling','Sprout','Elder'][stage]||'Hatchling';
  for(const k of ['hunger','happiness','energy']){const value=Math.round(Number(s[k])||0);$(k).value=value;$(k+'Text').textContent=value;}
  const needActions=[];if(Number(s.poops)>0)needActions.push('clean');if(s.sick)needActions.push('vitamin');
  for(const a of ['clean','vitamin'])$(a).hidden=!needActions.includes(a);
  $('needsActions').hidden=needActions.length===0;
  const who=s.name||'Your fren';
  $('petName').textContent=who;
  const resting=s.activity==='resting';
  $('mood').textContent=(s.feedback||s.mood||who+' is curious.')+(resting&&!s.feedback?' · Energy +'+Engine.RULES.restPerHour+'/hour':'');
  $('rest').lastChild.textContent=resting?'Wake up':'Nap';
  $('rest').firstElementChild.textContent=resting?'☀':'☾';
  $('rest').setAttribute('aria-pressed',String(resting));
  $('rest').title=resting?'Wake up and stop resting':'Recover '+Engine.RULES.restPerHour+' energy per hour while resting';
  $('age').textContent=`Day ${Number(s.day)||0}`;
  $('stage').classList.toggle('wandering',s.mode!=='bubble');
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===s.mode));
}
for(const a of ['feed','play','rest','clean','vitamin'])$(a).addEventListener('click',()=>{const s=action(a);render(s);if(!s.blocked){const animation=s.animation||{feed:'eat',play:'dance',rest:'sleep',clean:'happy',vitamin:'eat'}[a];window.animatePet?.(animation);window.tinyFrensEffects?.respond(animation);}});
for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>{
  let s;if(desktop)s=JSON.parse(desktop.setMode(b.dataset.mode));
  else if(native)s=JSON.parse(PetAndroid.setMode(b.dataset.mode));
  else{s=localRead();s.mode=b.dataset.mode;localStorage.setItem(key,JSON.stringify(s));}
  render(s);
});
function refreshFloatingButton(){
 if(!native&&!desktop)return;
 const visible=desktop?desktop.isPetVisible():PetAndroid.isPetVisible();$('start').textContent=visible?'Hide NFTs':'Show NFTs';$('start').setAttribute('aria-pressed',String(visible));
}
$('start').onclick=()=>{
 if(desktop){const visible=desktop.togglePet();$('message').textContent=visible?'Your fren is floating.':'Pet hidden.';refreshFloatingButton();return;}
 if(!native){$('stage').scrollIntoView({behavior:'smooth',block:'center'});$('message').textContent='Your imported NFTs appear here in TinyFrens.';return;}
 if(PetAndroid.isPetVisible()){PetAndroid.stopPet();$('message').textContent='Pet hidden.';$('start').textContent='Show NFTs';}
 else{const started=PetAndroid.startPet();$('message').textContent=started?'Your fren is ready! Switch apps.':'Ask a grown-up to allow floating, then tap Show NFTs again.';if(started)$('start').textContent='Hide NFTs';}
 $('start').disabled=true;setTimeout(()=>{$('start').disabled=false;refreshFloatingButton();},500);
};
if(native||desktop){refreshFloatingButton();setInterval(()=>{if(!document.hidden)refreshFloatingButton();},1000);}
$('platform').textContent=(native||desktop)?'Show your imported NFTs over other apps.':'Your imported NFTs appear here in TinyFrens.';
function editName(open){
  $('nameRow').hidden=open;$('nameForm').hidden=!open;
  if(open){$('nameInput').value=read().name||'';$('nameInput').focus();$('nameInput').select();}
}
$('editName').onclick=()=>editName(true);
$('shuffleName').onclick=()=>{$('nameInput').value=randomName(read().shape,$('nameInput').value);$('nameInput').focus();};
$('nameForm').onsubmit=e=>{e.preventDefault();const n=cleanName($('nameInput').value);if(n){render(rename(n));window.dispatchEvent(new Event('pet-profile-changed'));}editName(false);};
$('nameInput').onkeydown=e=>{if(e.key==='Escape')editName(false);};
function refreshCare(){const s=read();render(s);window.stylePet?.(s);refreshFloatingButton();}
window.onAndroidResume=refreshCare;
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCare();});
const careScreen=$('screen-care');
new MutationObserver(()=>{if(!careScreen.hidden)refreshCare();}).observe(careScreen,{attributes:true,attributeFilter:['hidden']});
if(!desktop)setInterval(()=>{if(!document.hidden&&!careScreen.hidden)refreshCare();},10000);
const _initS = ensureName(read());
render(_initS);
window.stylePet?.(_initS);


if(desktop){desktop.onState(s=>{render(s);window.stylePet?.(s);refreshFloatingButton();window.dispatchEvent(new Event('pet-profile-changed'));});desktop.onAnimation(name=>{if(name==='check-update'){$('checkUpdate').click();return;}window.animatePet?.(name==='toy'?'dance':name);});}

// Magic Link Restore Check
(async () => {
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  const match = hash.match(/restore=([a-zA-Z0-9_-]+)/) || search.match(/restore=([a-zA-Z0-9_-]+)/);
  if (match) {
    const code = match[1];
    const server = String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
    if (server) {
      try {
        const res = await fetch(server + '/api/wallet/restore', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({code})
        });
        const data = await res.json();
        if (data.success && data.token && data.pet) {
          const newId = { id: data.id, code: data.code, token: data.token };
          window.TinyFrensFriends?.setIdentity?.(newId);
          let s;
          if (desktop) s = JSON.parse(desktop.customize(JSON.stringify(data.pet)));
          else if (native) s = JSON.parse(PetAndroid.customize(JSON.stringify(data.pet)));
          else { s = Object.assign(read(), data.pet); localStorage.setItem(key, JSON.stringify(s)); }
          window.stylePet?.(s);
          render(s);
          window.history.replaceState(null, '', window.location.pathname);
          const moodEl = $('mood');
          if (moodEl) moodEl.textContent = `✨ Restored ${data.pet.name || 'fren'} from magic link!`;
          window.animatePet?.('dance');
        }
      } catch (e) {
        console.warn('Magic link restore error', e);
      }
    }
  }
})();

