(() => {
  const key = 'tinyfrens-companions';
  const identity = window.TinyFrensCompanionKey;
  const selection = nft => ({tokenId:nft.tokenId, originalAddress:nft.originalAddress, chainId:nft.chainId});
  const motionKey = 'tinyfrens-companion-motion';
  function motions() { try { return JSON.parse(localStorage.getItem(motionKey) || '{}'); } catch { return {}; } }
  function movement(nft) { return motions()[identity(nft)] || (nft.chainId !== 8453 ? motions()[nft.tokenId] : null) || nft.motion || {mode:'roam', speed:60}; }
  async function saveMovement(nft, motion) {
    if (window.PetAndroid?.turtleRequest || window.TinyFrensDesktop?.turtleRequest)
      await window.TinyFrensTurtleAPI(window.TINYFRENS_SERVER, '/native/companion-motion', {...selection(nft), ...motion});
    const settings = motions(); settings[identity(nft)] = motion;
    localStorage.setItem(motionKey, JSON.stringify(settings));
    nft.motion = motion;
  }
  window.TinyFrensCompanionSize = nft => movement(nft).size || 80;
  window.TinyFrensSetCompanionSize = async (nft, size, imported = true) => {
    const motion = {...movement(nft), size};
    if (imported) await saveMovement(nft, motion);
    else { const settings = motions(); settings[identity(nft)] = motion; localStorage.setItem(motionKey, JSON.stringify(settings)); }
  };
  const stage = document.getElementById('stage'), pet = document.getElementById('pet');
  if (!stage || !pet) return;
  const sprites = new Map();
  const empty = document.createElement('div');
  empty.className = 'companion-empty';
  empty.innerHTML = '<p>Import an NFT to see it here.</p><a href="#wallet" id="emptyConnectWallet">Connect a wallet ↑</a>';
  stage.append(empty);
  empty.querySelector('a').onclick = event => { event.preventDefault(); window.showScreen('wallet'); };
  const controls = document.createElement('div');
  controls.className = 'companion-controls';
  const movementMenu = document.createElement('details'); movementMenu.className = 'companion-movement-menu';
  const movementTitle = document.createElement('summary'); movementTitle.textContent = 'Movement settings';
  movementMenu.append(movementTitle, controls); stage.closest('.pet-card').after(movementMenu);
  let items = [], refreshing = false;
  function saved() {
    try {
      const list = JSON.parse(localStorage.getItem(key) || 'null');
      const legacy = JSON.parse(localStorage.getItem('tinyfrens-hood-turtle') || 'null');
      return Array.isArray(list) ? list : legacy ? [legacy] : [];
    } catch { return []; }
  }
  async function remove(nft) {
    if (window.PetAndroid?.turtleRequest || window.TinyFrensDesktop?.turtleRequest)
      await window.TinyFrensTurtleAPI(window.TINYFRENS_SERVER, '/native/remove-turtle', selection(nft));
    items = saved().filter(item => identity(item) !== identity(nft));
    localStorage.setItem(key, JSON.stringify(items));
    localStorage.removeItem('tinyfrens-hood-turtle');
    render();
  }
  function render() {
    const active = items.filter(nft => nft.active !== false && ['hood-turtles-v1', 'tinyfrens-robots-v1', 'nubs-v1', 'bots-computers-v1'].includes(nft.companion?.adapter) && Date.now() < nft.validUntil * 1000);
    stage.closest('.pet-card').hidden = !!window.PetAndroid || !active.length;
    const floating = document.querySelector('#screen-pet .floating-controls');
    if (floating) floating.hidden = !!window.PetAndroid || !active.length;
    pet.style.visibility = 'hidden';
    empty.hidden = active.length > 0;
    const ids = new Set(active.map(identity));
    for (const [id, sprite] of sprites) if (!ids.has(id)) { sprite.element.remove(); sprites.delete(id); }
    controls.replaceChildren(); movementMenu.hidden = !active.length;
    for (const nft of active) {
      if (!sprites.has(identity(nft))) {
        const element = document.createElement('img');
        element.className = 'collection-companion'; element.alt = nft.name;
        stage.append(element);
        sprites.set(identity(nft), {element, x:Math.random() * .6 + .1, direction:1, nft});
      }
      sprites.get(identity(nft)).nft = nft;
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
        try { await saveMovement(nft, {...movement(nft), mode:mode.value, speed:Number(speed.value)}); status.textContent = 'Saved on this device.'; }
        catch (error) { mode.value = movement(nft).mode; speed.value = movement(nft).speed; status.textContent = error.message; }
        finally { mode.disabled = false; speed.disabled = mode.value === 'bubble'; }
      };
      mode.onchange = update; speed.onchange = update;
      const button = document.createElement('button'); button.className = 'secondary';
      button.textContent = 'Remove ' + nft.name;
      button.onclick = () => remove(nft).catch(error => { button.textContent = error.message; });
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
      const device = window.TinyFrensFriends?.identity?.() || JSON.parse(localStorage.getItem('tinyfrens-device:' + base) || 'null');
      if (!device?.token) return;
      for (const nft of [...items]) {
        const data = await window.TinyFrensTurtleAPI(base, '/api/featured/companion', {token:device.token, ...selection(nft)});
        const current = saved();
        const index = current.findIndex(item => identity(item) === identity(nft));
        if (index < 0) continue;
        if (data.active) current[index] = {...data, motion:current[index].motion}; else current.splice(index, 1);
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
      element.style.width = (motion.size || 80) + 'px'; element.style.height = (motion.size || 80) + 'px';
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
