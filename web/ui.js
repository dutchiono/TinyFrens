'use strict';
const desktopApp = Boolean(window.TinyFrensDesktop);
if (desktopApp) {
 document.body.classList.add('desktop-app');
 const petScreen=document.getElementById('screen-pet');
 const oldHeading=petScreen?.querySelector('.collection-heading');
 if(oldHeading)oldHeading.hidden=true;
 if(petScreen){
  const welcome=document.createElement('section');
  welcome.className='desktop-welcome';
  welcome.innerHTML=`<p class="desktop-kicker">START HERE</p><h1>Your fren is ready.</h1><p class="desktop-lead">Feed them, play with them, or let them nap. You do not need a wallet or an NFT to use the desktop companion.</p><div class="desktop-start-actions"><button type="button" data-screen="care">Care for my fren</button><button type="button" class="secondary" data-screen="looks">Change their look</button></div><p class="desktop-optional">Want to bring an NFT along later? That is optional and lives under <strong>NFTs</strong>.</p>`;
  petScreen.prepend(welcome);
 }
 const walletScreen=document.getElementById('screen-wallet');
 const walletPanel=document.getElementById('externalWalletPanel');
 if(walletScreen){
  const title=walletScreen.querySelector('h1');if(title)title.textContent='Bring an NFT along';
  const intro=walletScreen.querySelector('.screen-intro');if(intro)intro.textContent='Optional: link a wallet, then choose supported NFTs to show on this computer.';
  if(walletPanel)intro?.after(walletPanel);
 }
 const lookPanel=document.getElementById('lookPanel');
 if(lookPanel&&walletScreen){
  const looks=document.createElement('section');
  looks.id='screen-looks';looks.className='screen';looks.hidden=true;
  looks.innerHTML='<div class="collection-heading"><div><h1>Change their look</h1><p class="screen-intro">Pick a species, colour, expression, and accessory. Changes save immediately.</p></div></div>';
  lookPanel.hidden=false;looks.append(lookPanel);walletScreen.before(looks);
 }
}
window.showScreen=name=>{
 if(typeof name==='string'&&name.includes('?'))name=name.split('?')[0];
 if(name==='settings')name='account';
 if(name==='plaza'||name==='public')name='party';
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
 if(name==='party'){
  if(window.TinyFrensParty&&!window.TinyFrensParty.getActive()){
   window.TinyFrensParty.joinPublic();
  }
  if(document.getElementById('visitRequests')?.children.length||document.getElementById('guestVisit')){const social=document.querySelector('.party-social');if(social)social.open=true;}
 }
 const more=document.getElementById('moreMenu');if(more){more.open=false;}
 history.replaceState(null,'','#'+(name==='party'?'plaza':name));window.scrollTo(0,0);
 if(name==='wallet'){const manager=document.getElementById('walletManager');if(manager)manager.open=true;}
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
