'use strict';
const styleSection=document.createElement('section');
styleSection.className='overlay';
styleSection.innerHTML='<div id="lookPreview" class="look-preview" aria-label="Appearance preview"></div><div class="nft-sync-box" style="margin:0 0 18px;padding:14px;background:#e8e0f1;border-radius:12px;"><label for="nftTokenInput" style="font-weight:700;margin:0 0 4px">Replicate TinyFren NFT</label><p class="small" style="margin:2px 0 8px;color:#5d3a8e;">Enter your on-chain token ID (#1–#888) to copy its exact NFT traits.</p><div class="actions" style="margin:0"><input id="nftTokenInput" type="number" min="1" max="888" placeholder="Token # e.g. 42 (1–888)" style="background:#fff;border-radius:8px;padding:8px;width:100%"><button id="syncNftButton" type="button" class="secondary" style="flex:none">Sync Look</button></div></div><label for="petColor">Colour</label><input id="petColor" type="color" value="#a474f1"><label for="petShape">Shape</label><select id="petShape"><option value="cat">Cat</option><option value="blob">Blob</option><option value="robot">Simple robot</option><option value="bunny">Bunny</option><option value="dog">Puppy dog</option><option value="bear">Teddy bear</option><option value="frog">Frog</option><option value="turtle">Turtle</option></select><label for="petExpression">Expression</label><select id="petExpression"><option value="happy">Classic Happy</option><option value="wink">Playful Wink</option><option value="shades">Cool Shades</option><option value="star_eyes">Star Eyes</option></select><label for="petAccessory">Accessory</label><select id="petAccessory"><option value="none">None</option><option value="party_hat">Party Hat</option><option value="crown">Royal Crown</option><option value="halo">Angel Halo</option><option value="bow_tie">Dapper Bow Tie</option><option value="orb">Mystic Orb</option></select><label for="petSize">Size <output id="sizeValue">80</output></label><input id="petSize" type="range" min="56" max="128" value="80"><label for="petSpeed">Wander speed <output id="speedValue">60</output></label><input id="petSpeed" type="range" min="20" max="140" value="60"><div class="actions"><button id="resetStyle" class="secondary">Reset look</button></div><p id="styleMessage" role="status"></p>';
$('lookPanel').append(styleSection);
const validShapes=['cat','blob','robot','bunny','dog','bear','frog','turtle'];
const validExprs=['joyful','wink','shades','star_eyes','sleepy','loving','laser','grin'];
const validAccs=['none','party_hat','crown','halo','bow_tie','orb'];
const validExprs=['happy','wink','shades','star_eyes'];
function nftTraits(tokenId){
 const SPECIES=['cat','blob','robot','bunny','dog','bear','frog','turtle'];
 const PALETTES=['#a474f1','#66c7d2','#ffb95e','#82eba1','#ff82a7','#4d96ff','#3a2d52','#ffd700'];
 const EXPRS=['happy','wink','shades','star_eyes'];
 const ACCS=['none','party_hat','crown','halo','bow_tie','orb'];
 let s=Number(BigInt(Number(tokenId)*104729+7919)%2147483647n);
 function rand(){s=(s*16807)%2147483647;return(s-1)/2147483646;}
 const species=SPECIES[(Number(tokenId)-1)%8];
 const palRoll=rand()*100;
 const color=palRoll<5?PALETTES[7]:palRoll<20?PALETTES[6]:PALETTES[Math.floor(rand()*6)];
 const expr=EXPRS[Math.floor(rand()*EXPRS.length)];
 const acc=ACCS[Math.floor(rand()*ACCS.length)];
 return {
  shape:species,
  color,
  expression:expr,
  accessory:acc,
  tokenId:Number(tokenId)
 };
}
function stylePet(s){
 const color=/^#[0-9a-f]{6}$/i.test(s.color||'')?s.color:'#a474f1';
 const shape=s.shape==='mascot'?'robot':validShapes.includes(s.shape)?s.shape:'cat';
 const expr=validExprs.includes(s.expression)?s.expression:'joyful';
 const acc=validAccs.includes(s.accessory)?s.accessory:'none';
 $('petColor').value=color;$('petShape').value=shape;$('petExpression').value=expr;$('petAccessory').value=acc;$('petSize').value=s.size||80;$('petSpeed').value=s.speed||60;
 if(s.tokenId)$('nftTokenInput').value=s.tokenId;
 $('sizeValue').textContent=s.size||80;$('speedValue').textContent=s.speed||60;
 $('pet').style.setProperty('--pet-color',color);$('pet').style.setProperty('--pet-scale',String((s.size||80)/80));
 $('pet').dataset.shape=shape;$('pet').dataset.expression=expr;$('pet').dataset.accessory=acc;
 $('pet').style.setProperty('--wander-time',String(500/(s.speed||60))+'s');
 const preview=$('pet').cloneNode(true);preview.removeAttribute('id');preview.dataset.action='';preview.style.animation='none';$('lookPreview').replaceChildren(preview);
}
function saveLook(reset){
 const data=reset?{color:'#a474f1',shape:'cat',expression:'joyful',accessory:'none',size:80,speed:60,tokenId:null}:{
  color:$('petColor').value,shape:$('petShape').value,expression:$('petExpression').value,accessory:$('petAccessory').value,
  size:Number($('petSize').value),speed:Number($('petSpeed').value),tokenId:$('nftTokenInput').value?Number($('nftTokenInput').value):null
 };
 let state;
 if(desktop)state=JSON.parse(desktop.customize(JSON.stringify(data)));
 else if(native)state=JSON.parse(PetAndroid.customize(JSON.stringify(data)));
 else{state=Object.assign(read(),data);localStorage.setItem(key,JSON.stringify(state));}
 stylePet(state);render(state);window.dispatchEvent(new Event('pet-profile-changed'));$('styleMessage').textContent=(native||desktop)?'Saved! Your floating pet changes immediately.':'Look saved on this device.';
}
$('resetStyle').onclick=()=>saveLook(true);
for(const id of ['petColor','petSize','petSpeed'])$(id).addEventListener('input',()=>saveLook(false));
for(const id of ['petShape','petExpression','petAccessory'])$(id).addEventListener('change',()=>saveLook(false));
$('syncNftButton').onclick=()=>{
 const id=parseInt($('nftTokenInput').value,10);
 if(!id||id<1||id>888){$('styleMessage').textContent='Enter a valid token ID between 1 and 888.';return;}
 const t=nftTraits(id);
 $('petColor').value=t.color;$('petShape').value=t.shape;$('petExpression').value=t.expression;$('petAccessory').value=t.accessory;
 saveLook(false);
 $('styleMessage').textContent='Replicated TinyFren #'+id+' appearance!';
};
function animatePet(name){$('pet').dataset.action=name;clearTimeout(window.petActionTimeout);window.petActionTimeout=setTimeout(()=>{$('pet').dataset.action='';},name==='sleep'?15000:6000);}
$('wavePet').onclick=()=>{if(desktop)desktop.action('wave');else if(native)PetAndroid.action('wave');animatePet('wave');window.tinyFrensEffects?.respond('wave');};
$('dancePet').onclick=()=>{if(desktop)desktop.action('dance');else if(native)PetAndroid.action('dance');animatePet('dance');window.tinyFrensEffects?.respond('dance');};
$('toyPet').onclick=()=>{
 window.tinyFrensEffects?.respond('toy');
 if(desktop){desktop.action('toy');$('styleMessage').textContent='Toy placed beside your floating pet.';}
 else if(native){PetAndroid.toy();$('styleMessage').textContent='Toy placed. Show your pet to watch the chase.';}
 else{
  const stage=$('stage');stage.classList.add('chasing');let toy=stage.querySelector('.web-toy');
  if(!toy){toy=document.createElement('button');toy.className='web-toy';toy.textContent='●';toy.setAttribute('aria-label','Move the toy');stage.append(toy);}
  toy.style.left=(25+Math.random()*50)+'%';toy.onclick=()=>$('toyPet').click();
  animatePet('dance');clearTimeout(window.webToyTimer);window.webToyTimer=setTimeout(()=>{stage.classList.remove('chasing');toy.remove();},6000);
  $('styleMessage').textContent='Toy time! Android also supports chasing a toy across your screen.';
 }
};


stylePet(read());
$('stage').classList.toggle('wandering',read().mode!=='bubble');
if(native){
 const permissions=document.createElement('section');permissions.className='overlay';
 permissions.innerHTML='<h2>Android permissions</h2><p id="permissionStatus" role="status"></p><div class="actions"><button data-settings="overlay">Allow floating</button><button data-settings="app">App settings</button><button data-settings="install">Allow updates</button></div><p>Battery and notification controls are in App settings. If Android shows a floating-app list, choose Pocket Familiar.</p>';
 $('settingsPanel').append(permissions);
 for(const b of permissions.querySelectorAll('[data-settings]'))b.onclick=()=>PetAndroid.openSettings(b.dataset.settings);
 function refreshPermissions(){const p=JSON.parse(PetAndroid.permissions());$('permissionStatus').textContent='Floating: '+(p.overlay?'allowed':'needs permission')+' · In-app updates: '+(p.install?'allowed':'needs permission');}
 const resume=window.onAndroidResume;window.onAndroidResume=()=>{resume?.();refreshPermissions();stylePet(read());};
 refreshPermissions();
}


