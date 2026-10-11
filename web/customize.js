'use strict';
const styleSection=document.createElement('section');
styleSection.className='overlay';
styleSection.innerHTML='<div id="lookPreview" class="look-preview" aria-label="Appearance preview"></div><label for="petColor">Colour</label><input id="petColor" type="color" value="#a474f1"><label for="petShape">Shape</label><select id="petShape"><option value="cat">Cat</option><option value="blob">Blob</option><option value="robot">Simple robot</option><option value="mascot">PFP Robot</option></select><p id="mascotNote" hidden>This robot keeps its purple-and-cyan PFP look. Pick another shape to choose a colour.</p><label for="petSize">Size <output id="sizeValue">80</output></label><input id="petSize" type="range" min="56" max="128" value="80"><label for="petSpeed">Wander speed <output id="speedValue">60</output></label><input id="petSpeed" type="range" min="20" max="140" value="60"><div class="actions"><button id="resetStyle" class="secondary">Reset look</button></div><p id="styleMessage" role="status"></p>';
$('lookPanel').append(styleSection);
function stylePet(s){
 const color=/^#[0-9a-f]{6}$/i.test(s.color||'')?s.color:'#a474f1';
 const shape=['cat','blob','robot','mascot'].includes(s.shape)?s.shape:'cat';
 $('petColor').disabled=shape==='mascot';$('mascotNote').hidden=shape!=='mascot';
 $('petColor').value=color;$('petShape').value=shape;$('petSize').value=s.size||80;$('petSpeed').value=s.speed||60;
 $('sizeValue').textContent=s.size||80;$('speedValue').textContent=s.speed||60;
 $('pet').style.setProperty('--pet-color',color);$('pet').style.setProperty('--pet-scale',String((s.size||80)/80));$('pet').dataset.shape=shape;
 $('pet').style.setProperty('--wander-time',String(500/(s.speed||60))+'s');
 const preview=$('pet').cloneNode(true);preview.removeAttribute('id');preview.dataset.action='';preview.style.animation='none';$('lookPreview').replaceChildren(preview);
}
function saveLook(reset){
 const data=reset?{color:'#a474f1',shape:'cat',size:80,speed:60}:{color:$('petColor').value,shape:$('petShape').value,size:Number($('petSize').value),speed:Number($('petSpeed').value)};
 let state;
 if(native)state=JSON.parse(PetAndroid.customize(JSON.stringify(data)));
 else{state=Object.assign(read(),data);localStorage.setItem(key,JSON.stringify(state));}
 stylePet(state);render(state);window.dispatchEvent(new Event('pet-profile-changed'));$('styleMessage').textContent=native?'Saved! Your floating pet changes immediately.':'Look saved on this device.';
}
$('resetStyle').onclick=()=>saveLook(true);
for(const id of ['petColor','petSize','petSpeed'])$(id).addEventListener('input',()=>saveLook(false));
$('petShape').addEventListener('change',()=>saveLook(false));
function animatePet(name){$('pet').dataset.action=name;clearTimeout(window.petActionTimeout);window.petActionTimeout=setTimeout(()=>{$('pet').dataset.action='';},name==='sleep'?15000:6000);}
$('wavePet').onclick=()=>{if(native)PetAndroid.action('wave');animatePet('wave');};
$('dancePet').onclick=()=>{if(native)PetAndroid.action('dance');animatePet('dance');};
$('toyPet').onclick=()=>{
 if(native){PetAndroid.toy();$('styleMessage').textContent='Toy placed. Show your pet to watch the chase.';}
 else{
  const stage=$('stage');stage.classList.add('chasing');let toy=stage.querySelector('.web-toy');
  if(!toy){toy=document.createElement('button');toy.className='web-toy';toy.textContent='●';toy.setAttribute('aria-label','Move the toy');stage.append(toy);}
  toy.style.left=(25+Math.random()*50)+'%';toy.onclick=()=>$('toyPet').click();
  animatePet('dance');clearTimeout(window.webToyTimer);window.webToyTimer=setTimeout(()=>{stage.classList.remove('chasing');toy.remove();},6000);
  $('styleMessage').textContent='Toy time! Android also supports chasing a toy across your screen.';
 }
};

const mascotSprite=document.createElement('img');mascotSprite.className='mascot-sprite';mascotSprite.src='pets/mascot-robot.png';mascotSprite.alt='Purple and cyan TinyFrens robot';mascotSprite.draggable=false;$('pet').append(mascotSprite);

stylePet(read());
$('stage').classList.add('wandering');
if(native){
 const permissions=document.createElement('section');permissions.className='overlay';
 permissions.innerHTML='<h2>Android permissions</h2><p id="permissionStatus" role="status"></p><div class="actions"><button data-settings="overlay">Allow floating</button><button data-settings="app">App settings</button><button data-settings="install">Allow updates</button></div><p>Battery and notification controls are in App settings. If Android shows a floating-app list, choose Pocket Familiar.</p>';
 $('settingsPanel').append(permissions);
 for(const b of permissions.querySelectorAll('[data-settings]'))b.onclick=()=>PetAndroid.openSettings(b.dataset.settings);
 function refreshPermissions(){const p=JSON.parse(PetAndroid.permissions());$('permissionStatus').textContent='Floating: '+(p.overlay?'allowed':'needs permission')+' · In-app updates: '+(p.install?'allowed':'needs permission');}
 const resume=window.onAndroidResume;window.onAndroidResume=()=>{resume?.();refreshPermissions();stylePet(read());};
 refreshPermissions();
}

