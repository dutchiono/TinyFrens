(() => {
  const key = 'tinyfrens-companions';
  const motionKey = 'tinyfrens-companion-motion';
  function motions() { try { return JSON.parse(localStorage.getItem(motionKey) || '{}'); } catch { return {}; } }
  function movement(nft) { return motions()[nft.tokenId] || nft.motion || {mode:'roam', speed:60}; }
  async function saveMovement(nft, motion) {
    if (window.PetAndroid?.turtleRequest || window.TinyFrensDesktop?.turtleRequest)
      await window.TinyFrensTurtleAPI(window.TINYFRENS_SERVER, '/native/companion-motion', {tokenId:nft.tokenId, ...motion});
    const settings = motions(); settings[nft.tokenId] = motion;
    localStorage.setItem(motionKey, JSON.stringify(settings));
    nft.motion = motion;
  }
  const stage = document.getElementById('stage'), pet = document.getElementById('pet');
  if (!stage || !pet) return;
  const sprites = new Map();
  const empty = document.createElement('div');
  empty.className = 'companion-empty';
  empty.innerHTML = '<p>Import an NFT to see it here.</p><a href="hood-turtles.html">Connect my wallet →</a>';
  stage.append(empty);
  const controls = document.createElement('div');
  controls.className = 'companion-controls'; stage.after(controls);
  let items = [], refreshing = false;
  function saved() {
    try {
      const list = JSON.parse(localStorage.getItem(key) || 'null');
      const legacy = JSON.parse(localStorage.getItem('tinyfrens-hood-turtle') || 'null');
      return Array.isArray(list) ? list : legacy ? [legacy] : [];
    } catch { return []; }
  }
  async function remove(id) {
    if (window.PetAndroid?.turtleRequest || window.TinyFrensDesktop?.turtleRequest)
      await window.TinyFrensTurtleAPI(window.TINYFRENS_SERVER, '/native/remove-turtle', {tokenId:id});
    items = saved().filter(nft => nft.tokenId !== id);
    localStorage.setItem(key, JSON.stringify(items));
    localStorage.removeItem('tinyfrens-hood-turtle');
    render();
  }
  function render() {
    const active = items.filter(nft => nft.active !== false && nft.companion?.adapter === 'hood-turtles-v1' && Date.now() < nft.validUntil * 1000);
    pet.style.visibility = 'hidden';
    empty.hidden = active.length > 0;
    const ids = new Set(active.map(nft => nft.tokenId));
    for (const [id, sprite] of sprites) if (!ids.has(id)) { sprite.element.remove(); sprites.delete(id); }
    controls.replaceChildren();
    for (const nft of active) {
      if (!sprites.has(nft.tokenId)) {
        const element = document.createElement('img');
        element.className = 'collection-companion'; element.alt = nft.name;
        stage.append(element);
        sprites.set(nft.tokenId, {element, x:Math.random() * .6 + .1, direction:1, nft});
      }
      sprites.get(nft.tokenId).nft = nft;
      const row = document.createElement('section'); row.className = 'companion-settings';
      const title = document.createElement('h3'); title.textContent = nft.name;
      const modeLabel = document.createElement('label'); modeLabel.textContent = 'Movement';
      const mode = document.createElement('select'); mode.setAttribute('aria-label', nft.name + ' movement');
      for (const [value, text] of [['roam','Free roam'], ['bubble','Stay put']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; mode.append(option);
      }
      const motion = movement(nft); mode.value = motion.mode;
      const speedLabel = document.createElement('label'); speedLabel.textContent = 'Speed';
      const speed = document.createElement('input'); speed.type = 'range'; speed.min = '20'; speed.max = '140'; speed.value = motion.speed;
      speed.setAttribute('aria-label', nft.name + ' movement speed'); speed.disabled = mode.value === 'bubble';
      const status = document.createElement('p'); status.className = 'small'; status.setAttribute('role','status');
      const update = async () => {
        mode.disabled = true; speed.disabled = true;
        try { await saveMovement(nft, {mode:mode.value, speed:Number(speed.value)}); status.textContent = 'Saved on this device.'; }
        catch (error) { mode.value = movement(nft).mode; speed.value = movement(nft).speed; status.textContent = error.message; }
        finally { mode.disabled = false; speed.disabled = mode.value === 'bubble'; }
      };
      mode.onchange = update; speed.onchange = update;
      const button = document.createElement('button'); button.className = 'secondary';
      button.textContent = 'Remove ' + nft.name;
      button.onclick = () => remove(nft.tokenId).catch(error => { button.textContent = error.message; });
      modeLabel.append(mode); speedLabel.append(speed);
      row.append(title, modeLabel, speedLabel, button, status); controls.append(row);
    }
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const native = window.PetAndroid || window.TinyFrensDesktop;
      if (native?.getTurtle) {
        const data = JSON.parse(native.getTurtle());
        items = data.items || (data.active ? [data] : []);
        render(); return;
      }
      items = saved(); render();
      const base = String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
      const identity = window.TinyFrensFriends?.identity?.() || JSON.parse(localStorage.getItem('tinyfrens-device:' + base) || 'null');
      if (!identity?.token) return;
      for (const nft of [...items]) {
        const data = await window.TinyFrensTurtleAPI(base, '/api/featured/hood-turtle', {token:identity.token, tokenId:nft.tokenId});
        const current = saved();
        const index = current.findIndex(item => item.tokenId === nft.tokenId);
        if (index < 0) continue;
        if (data.active) current[index] = data; else current.splice(index, 1);
        localStorage.setItem(key, JSON.stringify(current)); items = current; render();
      }
    } catch { render(); }
    finally { refreshing = false; }
  }
  let last = 0;
  function tick(time) {
    const dt = Math.min((time - last) / 1000, .1); last = time;
    const reduced = document.documentElement.dataset.reducedMotion === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    let i = 0;
    for (const sprite of sprites.values()) {
      const {element, nft} = sprite;
      if (Date.now() >= nft.validUntil * 1000) { element.hidden = true; continue; }
      const motion = movement(nft), walking = !reduced && motion.mode === 'roam';
      if (walking) sprite.x += dt * .045 * (motion.speed / 60) * sprite.direction;
      if (sprite.x > .8) sprite.direction = -1; if (sprite.x < .02) sprite.direction = 1;
      const frame = walking ? nft.companion.frames[Math.floor(time / nft.companion.frameMs) % nft.companion.frames.length] : nft.companion.idle;
      if (element.getAttribute('src') !== frame) element.src = frame;
      element.style.left = sprite.x * 100 + '%';
      element.style.bottom = (14 + i++ * 12) + '%';
      element.style.transform = `scaleX(${sprite.direction})`;
    }
    requestAnimationFrame(tick);
  }
  window.TinyFrensDesktop?.onTurtle?.(refresh);
  window.addEventListener('storage', refresh);
  window.addEventListener('tinyfrens-wallet-link-changed', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh(); setInterval(refresh, 60000); requestAnimationFrame(tick);
})();
