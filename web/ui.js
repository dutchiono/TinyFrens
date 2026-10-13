'use strict';
window.showScreen=name=>{
 const walletRequested=name==='wallet';
 if(walletRequested)name='pet';
 const screens=[...document.querySelectorAll('[data-screen]')].map(tab=>tab.dataset.screen);
 if(!screens.includes(name))name='pet';
 for(const screen of document.querySelectorAll('.screen'))screen.hidden=screen.id!=='screen-'+name;
 for(const tab of document.querySelectorAll('[data-screen]')){const active=tab.dataset.screen===name;if(tab.getAttribute('role')==='tab'){tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}else{if(active)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');}}
 const homeBtn=document.getElementById('spaceHome'),plazaBtn=document.getElementById('spacePlaza');
 if(homeBtn&&plazaBtn){
  const isHome=name==='pet',isPlaza=name==='party';
  homeBtn.classList.toggle('active',isHome);homeBtn.setAttribute('aria-checked',String(isHome));
  plazaBtn.classList.toggle('active',isPlaza);plazaBtn.setAttribute('aria-checked',String(isPlaza));
 }
 if(name==='party'&&(document.getElementById('visitRequests')?.children.length||document.getElementById('guestVisit'))){const social=document.querySelector('.party-social');if(social)social.open=true;}
 const more=document.getElementById('moreMenu');if(more){more.open=false;}
 history.replaceState(null,'','#'+name);window.scrollTo(0,0);
 if(walletRequested){const manager=document.getElementById('walletManager');if(manager){manager.open=true;manager.scrollIntoView({block:'start'});}}
};
for(const tab of document.querySelectorAll('[data-screen]')){
 tab.onclick=()=>showScreen(tab.dataset.screen);
 tab.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-screen]')].filter(tab=>tab.getClientRects().length);const i=(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;showScreen(tabs[i].dataset.screen);tabs[i].focus();};
}
document.addEventListener('click',event=>{const more=document.getElementById('moreMenu');if(more&&!more.contains(event.target))more.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const more=document.getElementById('moreMenu');if(more?.open){more.open=false;more.querySelector('summary').focus();}}});
let hasImports=false;
try{const native=window.PetAndroid||window.TinyFrensDesktop;hasImports=native?.getTurtle?JSON.parse(native.getTurtle()).selected:JSON.parse(localStorage.getItem('tinyfrens-companions')||'[]').length>0||!!localStorage.getItem('tinyfrens-hood-turtle');}catch{}
showScreen(location.hash==='#video-pet'?'pet':location.hash.slice(1)||'pet');
