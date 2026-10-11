'use strict';
(()=>{
 const banner=$('updateBanner'),nowButton=$('updateNow'),status=$('updateStatus');
 const pref=(name,fallback)=>{try{return JSON.parse(localStorage.getItem('tinyfrens-'+name))??fallback;}catch{return fallback;}};
 const savePref=(name,value)=>{try{localStorage.setItem('tinyfrens-'+name,JSON.stringify(value));}catch{}};
 $('autoCheck').checked=pref('autoCheck',true);$('autoDownload').checked=pref('autoDownload',false);$('autoApply').checked=pref('autoApply',true);
 for(const id of ['autoCheck','autoDownload','autoApply'])$(id).onchange=()=>{savePref(id,$(id).checked);if(id==='autoCheck'&&$(id).checked)check(true);};
 let action=()=>{},lastCheck=0,inFlight=false,registration=null,started=false;
 const show=(title,detail,run,label='Update')=>{$('updateTitle').textContent=title;$('updateDetail').textContent=detail;nowButton.textContent=label;action=run;banner.hidden=false;};
 nowButton.onclick=()=>action();$('updateLater').onclick=()=>banner.hidden=true;
 const quietError=()=>{status.textContent='Couldn’t check right now. Your pet still works. Try again when you’re online.';};
 function androidResult(result){
  inFlight=false;$('checkUpdate').disabled=false;$('downloadUpdate').hidden=!result.available;
  $('installPetUpdate').hidden=!result.available;
  if(result.error){quietError();return;}
  status.textContent=result.available?'A new app version is ready.':'You’re up to date.';
  if(!result.available){banner.hidden=true;return;}
  const install=()=>PetAndroid.installUpdate();
  $('downloadUpdate').onclick=()=>PetAndroid.openUpdate(result.url);
  show('An update is ready','Ask a grown-up to install it. Your fren comes with you.',install,'Install update');
  if($('autoDownload').checked&&PetAndroid.canAutoDownload())PetAndroid.prepareUpdate();
 }
 if(native){
  const info=JSON.parse(PetAndroid.updateInfo());$('updateRepo').value=info.repo||'dutchiono/TinyFrens';
  $('advancedUpdates').hidden=false;$('autoDownloadRow').hidden=false;
  $('updateExplanation').textContent='Checks when you open the app and while it’s in use. Wi-Fi downloads are optional; Android still asks before installing.';
  const install=document.createElement('button');install.id='installPetUpdate';install.textContent='Install update';install.hidden=true;install.onclick=()=>PetAndroid.installUpdate();$('downloadUpdate').before(install);
  window.onPetUpdate=androidResult;
  window.onUpdateDownload=message=>{status.textContent=message;$('updateDetail').textContent=message;};
  window.onUpdateReady=()=>show('Your update is downloaded','Ask a grown-up to finish installing. Your pet stays saved.',()=>PetAndroid.installUpdate(),'Install update');
 }else if(window.PetIOS){
  $('updateExplanation').textContent='Checks for new iPhone builds. Native updates need your signing/AltStore setup; they cannot install themselves.';
  window.onIOSUpdate=result=>{
   inFlight=false;$('checkUpdate').disabled=false;
   if(result.error){quietError();return;}
   status.textContent=result.available?'A new iPhone build is ready.':'You’re up to date.';
   if(!result.available){banner.hidden=true;return;}
   show('An iPhone update is ready','Ask a grown-up to install the new build using AltStore.',()=>window.open('https://github.com/dutchiono/TinyFrens/blob/main/ios/README.md','_blank'),'Update help');
  };
 }else{
  $('autoApplyRow').hidden=false;
  $('updateExplanation').textContent='New files download in the background. Refresh to use them, or let the update apply next time you open. Your pet stays saved.';
  const hadController=!!navigator.serviceWorker?.controller;
  let applying=false,firstVisit=true;
  const apply=()=>{if(!registration?.waiting){location.reload();return;}applying=true;registration.waiting.postMessage({type:'SKIP_WAITING'});};
  const waiting=()=>{
   if(!registration?.waiting)return;
   status.textContent='An update is downloaded.';
   if(firstVisit&&$('autoApply').checked){apply();return;}
   show('A fresh update is ready','Refresh when you’re ready. Your pet is saved.',apply,'Refresh app');
  };
  if('serviceWorker' in navigator&&location.protocol.startsWith('http')){
   navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(applying||!hadController){if(applying)location.reload();return;}
    show('A fresh update is ready','Refresh to use it. Your pet stays saved.',()=>location.reload(),'Refresh app');
   });
   navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(r=>{
    registration=r;status.textContent=$('autoCheck').checked?'Website updates check automatically.':'Automatic checks are off.';waiting();firstVisit=false;
    r.addEventListener('updatefound',()=>{const worker=r.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)waiting();});});
    if($('autoCheck').checked)r.update().catch(()=>{});
   }).catch(quietError);
  }else status.textContent='Open the online pet in Safari to get website updates.';
  window.checkWebUpdate=async()=>{
   if(!registration){status.textContent='The offline update service is still getting ready. Try again shortly.';return;}
   await registration.update();
   waiting();
   if(!registration.waiting&&!registration.installing)status.textContent='You’re up to date.';
  };
 }
 async function check(manual=false){
  if(inFlight||(!manual&&Date.now()-lastCheck<15*60*1000)||(!manual&&!$('autoCheck').checked))return;
  lastCheck=Date.now();inFlight=true;$('checkUpdate').disabled=true;status.textContent='Checking…';
  try{
   if(native){
    if(!PetAndroid.saveUpdateRepo($('updateRepo').value.trim()))throw new Error('Invalid source');
    PetAndroid.checkUpdate();
   }else if(window.PetIOS){window.webkit.messageHandlers.petUpdates.postMessage('check');}
   else{await window.checkWebUpdate?.();inFlight=false;$('checkUpdate').disabled=false;}
  }catch{inFlight=false;$('checkUpdate').disabled=false;quietError();}
 }
 $('checkUpdate').onclick=()=>check(true);
 const resume=window.onAndroidResume;window.onAndroidResume=()=>{resume?.();check();};
 window.onIOSResume=()=>{render(read());check();};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
 window.addEventListener('online',()=>check());
 setInterval(()=>{if(!document.hidden)check();},15*60*1000);
 // Check only after all callback handlers have been installed.
 if($('autoCheck').checked)check(true);else status.textContent='Automatic checks are off. Tap Check now any time.';
})();
