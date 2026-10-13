'use strict';
(()=>{
 const banner=$('updateBanner'),nowButton=$('updateNow'),status=$('updateStatus');
 const pref=(name,fallback)=>{try{return JSON.parse(localStorage.getItem('tinyfrens-'+name))??fallback;}catch{return fallback;}};
 const savePref=(name,value)=>{try{localStorage.setItem('tinyfrens-'+name,JSON.stringify(value));}catch{}};
 $('autoCheck').checked=pref('autoCheck',true);$('autoDownload').checked=pref('autoDownload',false);$('autoApply').checked=pref('autoApply',true);
 for(const id of ['autoCheck','autoDownload','autoApply'])$(id).onchange=()=>{savePref(id,$(id).checked);if(id==='autoCheck'&&$(id).checked)check(true);};
 const dismiss=()=>{banner.close();banner.hidden=true;};
 banner.addEventListener("cancel",event=>{event.preventDefault();dismiss();});
 let action=()=>{},lastCheck=0,inFlight=false,registration=null,started=false;
 const show=(title,detail,run,label='Update')=>{$('updateTitle').textContent=title;$('updateDetail').textContent=detail;nowButton.textContent=label;action=run;nowButton.disabled=false;banner.hidden=false;if(!banner.open)banner.showModal();};
 nowButton.onclick=()=>action();$('updateLater').onclick=dismiss;
 const quietError=()=>{status.textContent='Couldn’t check right now. Your pet still works. Try again when you’re online.';};
 function androidResult(result){
  inFlight=false;$('checkUpdate').disabled=false;$('downloadUpdate').hidden=!result.available;
  $('installPetUpdate').hidden=!result.available;
  if(result.error){quietError();return;}
  status.textContent=result.available?'A new app version is ready.':'You’re up to date.';
  if(!result.available){dismiss();return;}
  const install=()=>PetAndroid.installUpdate();
  $('downloadUpdate').onclick=()=>PetAndroid.openUpdate(result.url);
  show('An update is ready','Download and install the latest TinyFrens. Your wallets and companions stay saved.',install,'Install update');
  if($('autoDownload').checked&&PetAndroid.canAutoDownload())PetAndroid.prepareUpdate();
 }
 if(window.TinyFrensDesktop){
  const auto=!!JSON.parse(window.TinyFrensDesktop.getState()||'{}').autoUpdate;
  $('updateExplanation').textContent=auto
   ? 'New versions download in the background. They install the next time you close the app, or tap Restart & install now. Your pet stays saved.'
   : 'Checks for new desktop downloads. Replace the app with the new version; your fren stays in its saved folder. Installation is manual.';
  window.TinyFrensDesktop.onUpdate?.(event=>{
   if(event.type==='checking')status.textContent='Checking…';
   else if(event.type==='available')status.textContent='Downloading the new version…';
   else if(event.type==='progress')status.textContent='Downloading update… '+event.percent+'%';
   else if(event.type==='downloaded'){status.textContent='A new version is ready.';show('An update is ready','Restart to install it. Your pet stays saved.',()=>window.TinyFrensDesktop.installUpdate(),'Restart & install');}
   else if(event.type==='error')quietError();
  });
 }else if(native){
  const info=JSON.parse(PetAndroid.updateInfo());$('updateRepo').value=info.repo||'dutchiono/TinyFrens';
  $('advancedUpdates').hidden=false;$('autoDownloadRow').hidden=false;
  $('updateExplanation').textContent='Checks when you open the app and while it’s in use. Wi-Fi downloads are optional; Android still asks before installing.';
  const install=document.createElement('button');install.id='installPetUpdate';install.textContent='Install update';install.hidden=true;install.onclick=()=>PetAndroid.installUpdate();$('downloadUpdate').before(install);
  window.onPetUpdate=androidResult;
  window.onUpdateDownload=message=>{status.textContent=message;$('updateDetail').textContent=message;nowButton.disabled=/^Downloading/i.test(message);if(!nowButton.disabled)nowButton.textContent='Try again';};
  window.onUpdateReady=()=>show('Your update is downloaded','Android will ask you to confirm installation. Your wallets and companions stay saved.',()=>PetAndroid.installUpdate(),'Install update');
 }else if(window.PetIOS){
  $('updateExplanation').textContent='Checks for new iPhone builds. Native updates need your signing/AltStore setup; they cannot install themselves.';
  window.onIOSUpdate=result=>{
   inFlight=false;$('checkUpdate').disabled=false;
   if(result.error){quietError();return;}
   status.textContent=result.available?'A new iPhone build is ready.':'You’re up to date.';
   if(!result.available){dismiss();return;}
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
   if(window.TinyFrensDesktop){
    const result=await window.TinyFrensDesktop.checkUpdate();
    inFlight=false;$('checkUpdate').disabled=false;
    if(result.error){quietError();return;}
    if(result.downloaded){status.textContent='A new version is ready.';show('An update is ready','Restart to install it. Your pet stays saved.',()=>window.TinyFrensDesktop.installUpdate(),'Restart & install');return;}
    if(result.auto){status.textContent=result.available?'Downloading the new version…':'You’re up to date.';if(!result.available)dismiss();return;}
    status.textContent=result.available?'A new desktop version is ready.':result.unpublished?'Your desktop build is ready; the first download is still publishing.':'You’re up to date.';
    if(result.available)show('A desktop update is ready','Download the new app and replace this version. Your pet stays saved.',()=>window.TinyFrensDesktop.openUpdate(),'Get update');else dismiss();
   }else if(native){
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

