'use strict';
window.showScreen=name=>{
 if(!['pet','looks','settings'].includes(name))name='pet';
 for(const screen of document.querySelectorAll('.screen'))screen.hidden=screen.id!=='screen-'+name;
 for(const tab of document.querySelectorAll('[data-screen]')){const active=tab.dataset.screen===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
 history.replaceState(null,'','#'+name);window.scrollTo(0,0);
};
for(const tab of document.querySelectorAll('[data-screen]')){
 tab.onclick=()=>showScreen(tab.dataset.screen);
 tab.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-screen]')];const i=(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:2))%3;showScreen(tabs[i].dataset.screen);tabs[i].focus();};
}
document.querySelector('.wordmark').onclick=e=>{e.preventDefault();showScreen('pet');};
showScreen(location.hash==='#video-pet'?'pet':location.hash.slice(1));
