'use strict';
const native = typeof window.PetAndroid !== 'undefined';
const key = 'pocket-familiar-v1';
const $ = id => document.getElementById(id);
function initial(){return {hunger:80,happiness:80,energy:80,born:Date.now(),last:Date.now(),mode:'roam'};}
function localRead(){
  let s; try{s=JSON.parse(localStorage.getItem(key)) || initial();}catch{s=initial();}
  const now=Date.now(), hours=Math.min(720,Math.max(0,Math.floor((now-(s.last||now))/3600000)));
  s.hunger=Math.max(0,s.hunger-hours*3);s.happiness=Math.max(0,s.happiness-hours*2);
  s.energy=Math.max(0,s.energy-hours);s.last=now;localStorage.setItem(key,JSON.stringify(s));return s;
}
function read(){return native?JSON.parse(PetAndroid.getState()):localRead();}
function action(name){
  if(native)return JSON.parse(PetAndroid.action(name));
  const s=localRead(), add=(k,n)=>s[k]=Math.max(0,Math.min(100,s[k]+n));
  if(name==='feed')add('hunger',25);
  if(name==='play'){add('happiness',20);add('energy',-12);add('hunger',-8);}
  if(name==='rest')add('energy',25);
  localStorage.setItem(key,JSON.stringify(s));return s;
}
function render(s){
  const stage=Math.min(2,Math.max(0,Math.floor((Date.now()-s.born)/86400000)));
  $('pet').dataset.stage=String(stage);
  $('stageText').textContent=['Hatchling','Sprout','Elder'][stage];
  for(const k of ['hunger','happiness','energy']){$(k).value=s[k];$(k+'Text').textContent=s[k];}
  $('mood').textContent=s.hunger<25?'Your familiar is hungry.':s.energy<25?'Your familiar needs a nap.':s.happiness<25?'Your familiar wants to play.':'Your familiar is curious.';
  $('age').textContent=`Age: ${Math.floor((Date.now()-s.born)/86400000)} days`;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===s.mode));
}
for(const a of ['feed','play','rest'])$(a).addEventListener('click',()=>render(action(a)));
for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>{
  let s;if(native)s=JSON.parse(PetAndroid.setMode(b.dataset.mode));
  else{s=localRead();s.mode=b.dataset.mode;localStorage.setItem(key,JSON.stringify(s));}
  render(s);
});
$('start').onclick=()=>{
  if(!native){$('message').textContent='Floating over other apps requires the Android APK. The PWA pet works inside your browser.';return;}
  $('message').textContent=PetAndroid.startPet()?'Pet enabled! Switch to another app.':'Allow “Display over other apps” in Android Settings, then tap Show pet again.';
};
$('stop').onclick=()=>{if(native){PetAndroid.stopPet();$('message').textContent='Pet hidden.';}else $('message').textContent='The browser pet is already contained in this page.';};
$('platform').textContent=native?'Tap Show pet and grant Android overlay permission. Drag the pet; tap it to open this screen.':'PWA mode: play here or install to your home screen. Android APK is required to float over other apps.';
window.onAndroidResume=()=>render(read());
render(read());
if('serviceWorker' in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});

let updateUrl = '';
window.onPetUpdate = result => {
  $('checkUpdate').disabled = false;
  $('downloadUpdate').hidden = true;
  updateUrl = '';
  if (result.error) { $('updateStatus').textContent = result.error; return; }
  $('updateStatus').textContent = result.available
    ? `Version ${result.versionName} is available. Download the APK, open it, and approve the update.`
    : 'Your pet is up to date.';
  if (result.available) { updateUrl = result.url; $('downloadUpdate').hidden = false; }
};
function checkPetUpdate() {
  const repo = $('updateRepo').value.trim();
  if (!PetAndroid.saveUpdateRepo(repo)) { $('updateStatus').textContent = 'Enter owner/repo.'; return; }
  $('checkUpdate').disabled = true;
  $('updateStatus').textContent = 'Checking GitHub…';
  PetAndroid.checkUpdate();
}
if (native) {
  $('updates').hidden = false;
  const info = JSON.parse(PetAndroid.updateInfo());
  $('updateRepo').value = info.repo;
  $('checkUpdate').onclick = checkPetUpdate;
  $('downloadUpdate').onclick = () => { if(updateUrl) PetAndroid.openUpdate(updateUrl); };
  $('updateStatus').textContent = `Installed: ${info.versionName}`;
  if (info.repo) checkPetUpdate();
}

if (window.PetIOS) {
  $('platform').textContent = 'iPhone / iPad: your familiar lives inside this app. iOS does not support the Android floating overlay.';
  $('start').hidden = true;
  $('stop').hidden = true;
  document.querySelector('.modes').hidden = true;
}
