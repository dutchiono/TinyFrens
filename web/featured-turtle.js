(() => {
  const storageKey = 'tinyfrens-hood-turtle';
  const stage = document.getElementById('stage');
  const pet = document.getElementById('pet');
  if (!stage || !pet) return;
  const display = document.createElement('div');
  display.className = 'featured-turtle';
  display.hidden = true;
  const image = document.createElement('img');
  image.alt = 'Loaded Hood Turtle';
  const label = document.createElement('span');
  display.append(image, label);
  stage.append(display);
  const unload = document.createElement('button');
  unload.type = 'button';
  unload.className = 'secondary featured-unload';
  unload.textContent = 'Unload Hood Turtle';
  unload.hidden = true;
  stage.after(unload);
  unload.addEventListener('click', () => {
    localStorage.removeItem(storageKey);
    window.clearImportedTurtle?.();
    clear();
  });

  function clear() {
    display.hidden = true;
    image.removeAttribute('src');
    pet.style.visibility = '';
    unload.hidden = true;
  }

  let validUntil = 0;
  new MutationObserver(() => { display.dataset.action = pet.dataset.action || ''; }).observe(pet, { attributes: true, attributeFilter: ['data-action'] });

  async function refresh() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch { clear(); return; }
    if (!saved || !Number.isInteger(saved.tokenId) || saved.tokenId < 1 || saved.tokenId > 2222) {
      clear();
      return;
    }
    const base = String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
    try {
      if (window.PetAndroid?.getTurtle) {
        const data = JSON.parse(PetAndroid.getTurtle());
        if (!data.active) { clear(); return; }
        show(data);
        return;
      }
      if (window.TinyFrensDesktop?.getTurtle) {
        const data = JSON.parse(TinyFrensDesktop.getTurtle());
        if (!data.active) { clear(); return; }
        show(data); return;
      }
      if (display.hidden && saved.image && Date.now() < saved.validUntil * 1000) show(saved);
      const storedIdentity = JSON.parse(localStorage.getItem('tinyfrens-device:' + base) || 'null');
      const token = window.TinyFrensFriends?.identity?.()?.token || storedIdentity?.token;
      if (!token) throw new Error('Fren identity unavailable');
      const data = await window.TinyFrensTurtleAPI(base, '/api/featured/hood-turtle', { token, tokenId: saved.tokenId });
      if (localStorage.getItem(storageKey) !== JSON.stringify(saved)) return;
      if (!data.active || (!data.image?.startsWith('data:image/svg+xml;base64,') &&
                           !data.image?.startsWith('data:image/png;base64,'))) {
        clear();
        return;
      }
      show(data);
      localStorage.setItem(storageKey, JSON.stringify({tokenId:data.tokenId, image:data.image, name:data.name, validUntil:data.validUntil}));
    } catch {
      if (Date.now() >= validUntil) clear();
    }
  }

  function show(data) {
      validUntil = Number(data.validUntil) * 1000;
      if (!Number.isFinite(validUntil) || Date.now() >= validUntil) { clear(); return; }
      image.src = data.image;
      image.alt = data.name;
      label.textContent = `${data.name} · Featured`;
      display.hidden = false;
      pet.style.visibility = 'hidden';
      unload.hidden = false;
  }

  window.TinyFrensDesktop?.onTurtle?.(refresh);
  refresh();
  setInterval(() => { if (Date.now() >= validUntil) clear(); }, 1000);
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('storage', event => { if (event.key === storageKey) refresh(); });
  window.addEventListener('tinyfrens-wallet-link-changed', refresh);
})();
