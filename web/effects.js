'use strict';
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const panel = document.createElement('section'); panel.className = 'overlay';
  panel.innerHTML = '<h2>Little touches</h2><label for="petOpacity">Pet opacity <output id="opacityValue">100%</output></label><input id="petOpacity" type="range" min="40" max="100" step="5" value="100"><label class="toggle"><span>Sparkles</span><input id="petSparkles" type="checkbox" checked></label><label class="toggle"><span>Screen effects</span><input id="petScreenEffects" type="checkbox" checked></label><label class="toggle"><span>Sounds</span><input id="petSounds" type="checkbox" checked></label><label class="toggle"><span>Fade in and out</span><input id="petFade" type="checkbox" checked></label><label class="toggle"><span>Haptic taps</span><input id="petHaptics" type="checkbox" checked></label><label class="toggle"><span>Reduce motion</span><input id="petReduceMotion" type="checkbox"></label><p id="effectsHelp" class="small">Gentle care effects, soft sounds, never flashing. System reduced-motion settings also apply.</p>';
  $('lookPanel').append(panel);
  const flags = {petSparkles:'sparkles',petScreenEffects:'screenEffects',petSounds:'sounds',petFade:'fade',petHaptics:'haptics',petReduceMotion:'reduceMotion'};
  function apply(s) {
    const opacity = Math.max(40, Math.min(100, Number(s.opacity) || 100));
    $('petOpacity').value=opacity;$('opacityValue').textContent=opacity+'%';
    for(const[id,name]of Object.entries(flags))$(id).checked=name==='reduceMotion'?s[name]===true:s[name]!==false;
    document.documentElement.dataset.reducedMotion=String(reduced.matches||s.reduceMotion===true);
    document.documentElement.dataset.petFade=String(s.fade!==false&&!reduced.matches&&s.reduceMotion!==true);
    $('pet').style.transition=s.fade!==false&&!reduced.matches&&s.reduceMotion!==true?'opacity 220ms ease':'none';
    $('pet').style.opacity=String(opacity/100);document.querySelectorAll('#lookPreview .pet').forEach(p=>p.style.opacity=String(opacity/100));
  }
  function save() {
    const data={...read(),opacity:Number($('petOpacity').value)};
    for(const[id,name]of Object.entries(flags))data[name]=$(id).checked;
    let state;if(desktop)state=JSON.parse(desktop.customize(JSON.stringify(data)));else if(native)state=JSON.parse(PetAndroid.customize(JSON.stringify(data)));else{state=data;localStorage.setItem(key,JSON.stringify(state));}
    apply(state);window.dispatchEvent(new Event('pet-profile-changed'));
  }
  $('petOpacity').oninput=save;for(const id of Object.keys(flags))$(id).onchange=save;
  const hapticSupported=native||!!window.PetIOS||(!desktop&&typeof navigator.vibrate==='function');
  $('petHaptics').disabled=!hapticSupported;
  if(!hapticSupported)$('effectsHelp').textContent+=' Haptic taps are unavailable on this device/browser.';
  const AudioCtor=window.AudioContext||window.webkitAudioContext;
  const audioSupported=!!AudioCtor;
  $('petSounds').disabled=!audioSupported;
  if(!audioSupported)$('effectsHelp').textContent+=' Sounds are unavailable in this browser.';
  let audio;
  function sound(name,s) {
    if(!audioSupported||s.sounds===false)return;
    try{
      audio=audio||new AudioCtor();
      audio.resume?.();
      const now=audio.currentTime, gain=audio.createGain();
      gain.connect(audio.destination);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.045,now+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+.22);
      const notes={feed:[523,659],play:[659,784],rest:[392,330],wave:[587,740],dance:[659,880],toy:[740,988]}[name]||[523,659];
      notes.forEach((freq,i)=>{const osc=audio.createOscillator();osc.type='sine';osc.frequency.setValueAtTime(freq,now+i*.07);osc.connect(gain);osc.start(now+i*.07);osc.stop(now+i*.16);});
    }catch{}
  }
  let clear;
  function respond(name) {
    const s=read();
    if(s.haptics!==false&&!native){try{if(window.PetIOS)window.webkit.messageHandlers.petUpdates.postMessage('tap');else if(!desktop)navigator.vibrate?.(12);}catch{}}
    sound(name,s);
    if(reduced.matches||s.reduceMotion===true)return;
    document.querySelector('.care-effect')?.remove();clearTimeout(clear);
    if(s.sparkles===false&&s.screenEffects===false)return;
    const effect=document.createElement('div');effect.className='care-effect care-'+name;effect.setAttribute('aria-hidden','true');
    if(s.screenEffects!==false)effect.classList.add('care-glow');
    if(s.sparkles!==false)for(let i=0;i<8;i++){const dot=document.createElement('span');dot.textContent=name==='sleep'?'✧':'✦';dot.style.setProperty('--dx',((i%4)-1.5)*65+'px');dot.style.setProperty('--dy',(i<4?-1:1)*(45+Math.random()*70)+'px');dot.style.setProperty('--delay',i*20+'ms');effect.append(dot);}
    const r=$('pet').getBoundingClientRect();effect.style.setProperty('--cx',r.x+r.width/2+'px');effect.style.setProperty('--cy',r.y+r.height/2+'px');document.body.append(effect);
    clear=setTimeout(()=>effect.remove(),1100);
  }
  window.tinyFrensEffects={respond,apply};
  window.addEventListener('pet-profile-changed',()=>apply(read()));
  reduced.addEventListener('change',()=>apply(read()));
  apply(read());
})();
