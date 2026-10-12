'use strict';
(() => {
  const bridge = window.TinyFrensDesktop, pet = document.getElementById('pet'), bubbles = document.getElementById('bubbles'), close = document.getElementById('closePet'), hint = document.getElementById('hint'), toy = document.getElementById('toy');
  let menuTimer, hintTimer, actionTimer, toyTimer, leaveTimer, pointer = null, lastState;
  const turtle = document.createElement('img'); turtle.className = 'overlay-turtle'; pet.append(turtle);
  let turtleData = JSON.parse(bridge.getTurtle());
  function renderTurtle(data = turtleData) {
    turtleData = data;
    pet.dataset.turtle = String(data.selected);
    turtle.hidden = !data.active || Date.now() >= data.validUntil * 1000;
    if (!turtle.hidden) { if (turtle.getAttribute('src') !== data.image) turtle.src = data.image; turtle.alt = data.name; }
    else turtle.removeAttribute('src');
  }
  bridge.onTurtle(renderTurtle); renderTurtle(); setInterval(() => renderTurtle(), 1000);
  function hitRegions() {
    bridge.regions([pet, ...(!bubbles.hidden ? [...bubbles.querySelectorAll('button'), close] : []), ...(!toy.hidden ? [toy] : [])].map(el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    }));
  }
  function message(text) { hint.textContent = text; hint.classList.add('shown'); clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.remove('shown'), 3500); }
  function menu(open) {
    bubbles.hidden = !open; close.hidden = !open; bridge.menu(open); clearTimeout(menuTimer);
    if (open) menuTimer = setTimeout(() => menu(false), 8000);
    hitRegions();
  }
  // Keep the bubbles from hanging around: close shortly after the cursor leaves the pet and buttons.
  function scheduleClose() { clearTimeout(leaveTimer); leaveTimer = setTimeout(() => { if (!pointer) menu(false); }, 900); }
  function render(s) {
    lastState = s;
    pet.dataset.shape = s.shape;
    pet.dataset.expression = s.expression || 'happy';
    pet.dataset.accessory = s.accessory || 'none';
    pet.dataset.stage = String(Math.min(2, Math.floor((Date.now() - s.born) / 86400000)));
    bubbles.querySelector('[data-action=clean]').hidden = !(Number(s.poops) > 0);
    bubbles.querySelector('[data-action=vitamin]').hidden = !s.sick;
    pet.style.setProperty('--pet-color', s.color); pet.style.setProperty('--pet-scale', String(s.size / 80));
    pet.style.opacity=String(s.opacity/100);const reduced=s.reduceMotion||matchMedia('(prefers-reduced-motion: reduce)').matches;document.documentElement.dataset.reducedMotion=String(reduced);bridge.motion(reduced);
    pet.setAttribute('aria-label', s.name + '. Click for care, drag to move.');
    const r = pet.getBoundingClientRect(); close.style.left = Math.min(296, r.right + 3) + 'px'; close.style.top = Math.max(40, r.top - 8) + 'px';
    for (const b of bubbles.querySelectorAll('[data-action]')) b.disabled = false;
    if (s.feedback) message(s.feedback);
    if (!s.visible) menu(false);
    hitRegions();
  }
  function animation(name) {
    if (name === 'check-update') return;
    const s=lastState;
    if(s&&!s.reduceMotion&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&(s.sparkles||s.screenEffects)){
      document.querySelector('.care-effect')?.remove();const effect=document.createElement('div');effect.className='care-effect care-'+name+(s.screenEffects?' care-glow':'');effect.setAttribute('aria-hidden','true');effect.style.setProperty('--cx','170px');effect.style.setProperty('--cy','174px');
      if(s.sparkles)for(let i=0;i<8;i++){const dot=document.createElement('span');dot.textContent='✦';dot.style.setProperty('--dx',((i%4)-1.5)*55+'px');dot.style.setProperty('--dy',(i<4?-1:1)*75+'px');dot.style.setProperty('--delay',i*20+'ms');effect.append(dot);}document.body.append(effect);setTimeout(()=>effect.remove(),1100);
    }
    if (name === 'toy') {
      toy.hidden = false; toy.style.left = (45 + Math.random() * 235) + 'px'; message('Toy time!');
      name = 'dance'; clearTimeout(toyTimer); toyTimer = setTimeout(() => { toy.hidden = true; hitRegions(); }, 6000);
    }
    pet.dataset.action = name; clearTimeout(actionTimer);
    actionTimer = setTimeout(() => { pet.dataset.action = ''; hitRegions(); }, name === 'sleep' ? 15000 : 6000);
    hitRegions();
  }
  pet.onpointerenter = () => { if (!pointer) { menu(true); message(lastState?.name + ' · Feed, Play, Nap or More'); } };
  pet.onpointerleave = scheduleClose;
  bubbles.onpointerleave = scheduleClose;
  bubbles.onpointerenter = () => { clearTimeout(leaveTimer); if (bubbles.hidden) menu(true); };
  pet.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); pointer = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false };
    pet.setPointerCapture(event.pointerId); bridge.drag(true);
  };
  pet.onpointermove = event => {
    if (!pointer) return;
    if (Math.hypot(event.screenX - pointer.x, event.screenY - pointer.y) > 5 && !pointer.moved) { pointer.moved = true; menu(false); hint.classList.remove('shown'); }
  };
  function endPointer(event) { if (!pointer) return; const moved = pointer.moved; pointer = null; bridge.drag(false); if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId); if (!moved && event.type === 'pointerup') menu(true); }
  pet.onpointerup = endPointer; pet.onpointercancel = endPointer;
  pet.onlostpointercapture = () => { pointer = null; bridge.drag(false); };
  window.onblur = () => { pointer = null; bridge.drag(false); };
  pet.onkeydown = event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); menu(true); bubbles.querySelector('button:not(:disabled)')?.focus(); } if (event.key === 'Escape') menu(false); };
  document.onkeydown = event => { if (event.key === 'Escape') menu(false); };
  close.onclick = () => { menu(false); bridge.hidePet(); };
  document.getElementById('more').onclick = () => { menu(false); bridge.openApp(); };
  for (const b of bubbles.querySelectorAll('button')) {
    b.onpointerenter = b.onfocus = () => { menu(true); message(b.dataset.label); };
    if (b.dataset.action) b.onclick = () => { bridge.action(b.dataset.action); menu(true); };
  }
  toy.onclick = () => bridge.action('toy');
  bridge.onState(render); bridge.onAnimation(animation); render(JSON.parse(bridge.getState()));
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>render(lastState));
  // Animated transforms change hit areas: never let the transparent margin intercept desktop clicks.
  setInterval(hitRegions, 150);
})();
