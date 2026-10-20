'use strict';
window.showScreen=name=>{
 if(typeof name==='string'&&name.includes('?'))name=name.split('?')[0];
 if(name==='settings')name='account';
 if(name==='plaza'||name==='public')name='party';
 const walletRequested=name==='wallet';
 if(walletRequested)name=document.getElementById('walletManager')?.closest('#screen-pet')?'pet':'account';
 if(!document.getElementById('screen-'+name)?.classList.contains('screen'))name='pet';
 for(const screen of document.querySelectorAll('.screen'))screen.hidden=screen.id!=='screen-'+name;
 for(const tab of document.querySelectorAll('[data-screen]')){const active=tab.dataset.screen===name;if(tab.getAttribute('role')==='tab'){tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}else{if(active)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');}}
 document.querySelector('.tf-nav-tabs [aria-current=page]')?.scrollIntoView({block:'nearest',inline:'nearest'});
 if(name==='party'){
  if(window.TinyFrensParty&&!window.TinyFrensParty.getActive()){
   window.TinyFrensParty.joinPublic();
  }
  if(document.getElementById('visitRequests')?.children.length||document.getElementById('guestVisit')){const social=document.querySelector('.party-social');if(social)social.open=true;}
 }
 const more=document.getElementById('moreMenu');if(more){more.open=false;}
 history.replaceState(null,'','#'+(name==='party'?'plaza':name));window.scrollTo(0,0);
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
let initialHash = location.hash==='#video-pet'?'pet':location.hash.slice(1)||'pet';
if(initialHash.includes('?')) initialHash = initialHash.split('?')[0];
showScreen(initialHash);
