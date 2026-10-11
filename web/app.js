'use strict';
const native = typeof window.PetAndroid !== 'undefined';
const desktop = window.TinyFrensDesktop;
const key = 'pocket-familiar-v1';
const $ = id => document.getElementById(id);
function initial(){return {hunger:80,happiness:80,energy:80,born:Date.now(),last:Date.now(),mode:'roam'};}
function localRead(){
  let s; try{s=JSON.parse(localStorage.getItem(key)) || initial();}catch{s=initial();}
  if(s.shape==='mascot')s.shape='robot';
  const now=Date.now(), hours=Math.min(720,Math.max(0,Math.floor((now-(s.last||now))/3600000)));
  s.hunger=Math.max(0,s.hunger-hours*3);s.happiness=Math.max(0,s.happiness-hours*2);
  s.energy=Math.max(0,s.energy-hours);s.last=hours>0?(s.last||now)+hours*3600000:(s.last||now);localStorage.setItem(key,JSON.stringify(s));return s;
}
function read(){return desktop?JSON.parse(desktop.getState()):native?JSON.parse(PetAndroid.getState()):localRead();}
const NAMES={
  cat:['Mochi','Whiskers','Biscuit','Pudding','Miso','Noodle','Tofu','Pebble','Marshmallow','Sprinkles','Mittens','Purrcy','Tiramisu','Butterscotch','Clementine','Nugget'],
  blob:['Gloop','Jellybean','Bubbles','Squish','Wobble','Gumdrop','Puddle','Dumpling','Boba','Blorp','Jiggles','Plum','Goober','Squidge','Gelato','Bloop'],
  robot:['Bolt','Widget','Sprocket','Beep','Gizmo','Pixel','Chip','Rivet','Zippy','Bleep','Cogsworth','Byte','Servo','Tinker','Boop-3','Sparky']
};

function cleanName(n){return [...String(n||'').replace(/[\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim()].slice(0,20).join('');}
function randomName(shape,avoid){
  const bank=(NAMES[shape]||NAMES.cat).filter(n=>n!==avoid);
  return bank[Math.floor(Math.random()*bank.length)];
}
function rename(n){
  const name=cleanName(n);
  if(desktop)return JSON.parse(desktop.rename(name));
  if(native)return JSON.parse(PetAndroid.rename(name));
  const s=localRead();if(name)s.name=name;localStorage.setItem(key,JSON.stringify(s));return s;
}
function ensureName(s){return s.name?s:rename(randomName(s.shape));}
function action(name){
  if(desktop)return JSON.parse(desktop.action(name));
  if(native)return JSON.parse(PetAndroid.action(name));
  const s=localRead();
  const blocked=name==='feed'&&s.hunger>=100?'Already full.':name==='rest'&&s.energy>=100?'Not sleepy yet.':name==='play'&&s.energy<12?'A nap first, then play.':name==='play'&&s.hunger<8?'A snack first, then play.':'';
  if(blocked)return {...s,blocked:true,feedback:blocked};
  const before={...s}, add=(k,n)=>s[k]=Math.max(0,Math.min(100,s[k]+n));
  if(name==='feed')add('hunger',25);
  if(name==='play'){add('happiness',20);add('energy',-12);add('hunger',-8);}
  if(name==='rest')add('energy',25);
  localStorage.setItem(key,JSON.stringify(s));
  const feedback=name==='feed'?'Snacks +'+(s.hunger-before.hunger):name==='rest'?'Energy +'+(s.energy-before.energy):name==='play'?'Joy +'+(s.happiness-before.happiness)+' · Energy −12 · Snacks −8':'';
  return {...s,feedback};
}
function render(s){
  const stage=Math.min(2,Math.max(0,Math.floor((Date.now()-s.born)/86400000)));
  $('pet').dataset.stage=String(stage);
  $('stageText').textContent=['Hatchling','Sprout','Elder'][stage];
  for(const k of ['hunger','happiness','energy']){$(k).value=s[k];$(k+'Text').textContent=s[k];}
  const who=s.name||'Your fren';
  $('petName').textContent=who;
  $('mood').textContent=s.feedback||who+(s.hunger<25?' is hungry.':s.energy<25?' needs a nap.':s.happiness<25?' wants to play.':' is curious.');
  $('age').textContent=`Day ${Math.floor((Date.now()-s.born)/86400000)}`;
  $('stage').classList.toggle('wandering',s.mode!=='bubble');
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===s.mode));
}
for(const a of ['feed','play','rest'])$(a).addEventListener('click',()=>{const s=action(a);render(s);if(!s.blocked){const animation={feed:'eat',play:'dance',rest:'sleep'}[a];window.animatePet?.(animation);window.tinyFrensEffects?.respond(animation);}});
for(const b of document.querySelectorAll('[data-mode]'))b.addEventListener('click',()=>{
  let s;if(desktop)s=JSON.parse(desktop.setMode(b.dataset.mode));
  else if(native)s=JSON.parse(PetAndroid.setMode(b.dataset.mode));
  else{s=localRead();s.mode=b.dataset.mode;localStorage.setItem(key,JSON.stringify(s));}
  render(s);
});
function refreshFloatingButton(){
 if(!native&&!desktop)return;
 const visible=desktop?desktop.isPetVisible():PetAndroid.isPetVisible();$('start').textContent=visible?'Hide pet':'Show pet';$('start').setAttribute('aria-pressed',String(visible));
}
$('start').onclick=()=>{
 if(desktop){const visible=desktop.togglePet();$('message').textContent=visible?'Your fren is floating.':'Pet hidden.';refreshFloatingButton();return;}
 if(!native)return;
 if(PetAndroid.isPetVisible()){PetAndroid.stopPet();$('message').textContent='Pet hidden.';$('start').textContent='Show pet';}
 else{const started=PetAndroid.startPet();$('message').textContent=started?'Your fren is ready! Switch apps.':'Ask a grown-up to allow floating, then tap Show pet again.';if(started)$('start').textContent='Hide pet';}
 $('start').disabled=true;setTimeout(()=>{$('start').disabled=false;refreshFloatingButton();},500);
};
if(native||desktop){refreshFloatingButton();setInterval(()=>{if(!document.hidden)refreshFloatingButton();},1000);}
$('platform').textContent=(native||desktop)?'Let your fren wander while you use other apps.':'Try the floating video below.';
function editName(open){
  $('nameRow').hidden=open;$('nameForm').hidden=!open;
  if(open){$('nameInput').value=read().name||'';$('nameInput').focus();$('nameInput').select();}
}
$('editName').onclick=()=>editName(true);
$('shuffleName').onclick=()=>{$('nameInput').value=randomName(read().shape,$('nameInput').value);$('nameInput').focus();};
$('nameForm').onsubmit=e=>{e.preventDefault();const n=cleanName($('nameInput').value);if(n){render(rename(n));window.dispatchEvent(new Event('pet-profile-changed'));}editName(false);};
$('nameInput').onkeydown=e=>{if(e.key==='Escape')editName(false);};
window.onAndroidResume=()=>{render(read());refreshFloatingButton();};
render(ensureName(read()));


if(desktop){desktop.onState(s=>{render(s);window.stylePet?.(s);refreshFloatingButton();window.dispatchEvent(new Event('pet-profile-changed'));});desktop.onAnimation(name=>{if(name==='check-update'){$('checkUpdate').click();return;}window.animatePet?.(name==='toy'?'dance':name);});}

