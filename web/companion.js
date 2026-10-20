'use strict';
/**
 * TinyFrens — in-app floating companion ("hover" inside Telegram / Discord).
 *
 * IMPORTANT LIMITATION: Android and desktop float the pet as a real OS-level
 * overlay window above other apps. That is impossible inside Telegram (an iframe)
 * and Discord (an Activity iframe) — the platform sandbox forbids drawing over
 * other apps. The closest honest equivalent is a *draggable* pet pinned inside the
 * Mini App / Activity that carries quick care bubbles (Feed/Play/Nap/Wave), so the
 * fren still "follows you around" within the platform surface.
 *
 * On a plain browser it stays disabled and the pet lives in its normal screen.
 * Enabled by web/telegram.js (and later discord.js) via enable('telegram'|'discord').
 */
(() => {
  let layer = null;
  let sprite = null;
  let dragging = false;
  let moved = false;
  let offsetX = 0, offsetY = 0;

  function build() {
    if (layer) return layer;
    layer = document.createElement('div');
    layer.className = 'tf-companion';
    layer.setAttribute('role', 'button');
    layer.setAttribute('aria-label', 'Your fren — drag to move, tap for care');

    sprite = document.createElement('img');
    sprite.className = 'tf-companion-nft';
    sprite.alt = 'Your selected NFT companion';
    sprite.hidden = true;
    layer.append(sprite);

    const bubbles = document.createElement('div');
    bubbles.className = 'tf-companion-bubbles';
    const actions = [
      ['feed', '🍓'], ['play', '🎾'], ['rest', '☾'],
    ];
    for (const [action, emoji] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = emoji;
      b.title = action[0].toUpperCase() + action.slice(1);
      b.onclick = (ev) => { ev.stopPropagation(); doCare(action); };
      bubbles.append(b);
    }
    const wave = document.createElement('button');
    wave.type = 'button'; wave.textContent = '👋'; wave.title = 'Wave';
    wave.onclick = (ev) => { ev.stopPropagation(); window.animatePet && window.animatePet('wave'); window.TinyFrensTelegram && window.TinyFrensTelegram.haptic('medium'); };
    bubbles.append(wave);
    layer.append(bubbles);

    layer.addEventListener('click', () => { if (!moved) layer.classList.toggle('open'); });
    layer.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.append(layer);
    return layer;
  }

  function doCare(action) {
    const button = document.getElementById(action);
    if (button) { button.click(); window.TinyFrensTelegram && window.TinyFrensTelegram.haptic('light'); }
  }

  function refreshSprite() {
    if (!layer || !sprite) return;
    const selected = [...document.querySelectorAll('.collection-companion')].find(item => !item.hidden && item.getAttribute('src'));
    layer.hidden = !selected;
    sprite.hidden = !selected;
    if (selected && sprite.getAttribute('src') !== selected.getAttribute('src')) sprite.src = selected.src;
  }

  function onDown(ev) {
    dragging = true; moved = false;
    const rect = layer.getBoundingClientRect();
    offsetX = ev.clientX - rect.left;
    offsetY = ev.clientY - rect.top;
    layer.setPointerCapture && layer.setPointerCapture(ev.pointerId);
  }
  function onMove(ev) {
    if (!dragging) return;
    moved = true;
    const x = ev.clientX - offsetX, y = ev.clientY - offsetY;
    const maxX = window.innerWidth - layer.offsetWidth;
    const maxY = window.innerHeight - layer.offsetHeight;
    layer.style.left = Math.max(4, Math.min(maxX - 4, x)) + 'px';
    layer.style.top = Math.max(4, Math.min(maxY - 4, y)) + 'px';
    layer.style.right = 'auto'; layer.style.bottom = 'auto';
  }
  function onUp() { dragging = false; setTimeout(() => { moved = false; }, 0); }

  function enable(platform) {
    if (window.TinyFrensDesktop || window.PetAndroid) return; // real overlay already exists
    if (!layer) {
      build();
      document.body.classList.add('tf-has-companion');
      // Start in the lower-right corner above the tab bar.
      layer.style.right = '18px';
      layer.style.bottom = '86px';
      if (platform === 'discord') layer.classList.add('tf-companion-discord');
    }
    refreshSprite();
    window.addEventListener('tinyfrens-wallet-link-changed', refreshSprite);
    setInterval(refreshSprite, 250);
  }

  window.TinyFrensCompanion = { enable, isEnabled: () => Boolean(layer) };
})();
