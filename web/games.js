'use strict';
// Mini-games hub. Each game registers { id, title, emoji, blurb, mount(host, api) }.
// mount returns { pause(), resume(), destroy() } and calls api.onEnd({ score }) once.
(() => {
  const BEST_KEY = 'tinyfrens-games-v1';
  const games = [];
  let hub = null, screen = null, active = null;

  function bests() {
    try { const b = JSON.parse(localStorage.getItem(BEST_KEY)); return b && typeof b === 'object' ? b : {}; } catch { return {}; }
  }
  function saveBest(id, score) {
    const all = bests();
    const best = Math.max(Number(all[id]) || 0, score);
    all[id] = best;
    try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch {}
    return best;
  }

  // Prefers the imported NFT companion shown on the home screen, else the drawn fren.
  function makeFren() {
    const companion = document.querySelector('#stage .collection-companion[src]');
    if (companion) return el('img', { className: 'game-fren-img', src: companion.src, alt: companion.alt || 'Your fren' });
    const source = document.getElementById('pet');
    const fren = source ? source.cloneNode(true) : document.createElement('div');
    fren.removeAttribute('id');
    fren.classList.add('pet');
    fren.style.visibility = '';
    fren.style.opacity = '';
    fren.dataset.action = '';
    return fren;
  }

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props || {});
    if (children) node.append(...children);
    return node;
  }

  function showPicker() {
    stop();
    if (!hub) return;
    const best = bests();
    const list = el('div', { className: 'games-list' }, games.map(game => {
      const card = el('button', { type: 'button', className: 'game-card' }, [
        el('span', { className: 'game-card-emoji', textContent: game.emoji, ariaHidden: 'true' }),
        el('span', { className: 'game-card-text' }, [
          el('strong', { textContent: game.title }),
          el('small', { textContent: game.blurb }),
          el('small', { className: 'game-card-best', textContent: best[game.id] ? `Best: ${best[game.id]}` : 'New!' })
        ])
      ]);
      card.onclick = () => play(game);
      return card;
    }));
    hub.replaceChildren(list, el('p', { className: 'small games-note', textContent: 'More games are on the way.' }));
  }

  function play(game) {
    stop();
    const back = el('button', { type: 'button', className: 'secondary game-back', textContent: '← Games' });
    back.onclick = showPicker;
    const title = el('h2', { className: 'game-title', textContent: `${game.emoji} ${game.title}` });
    const stage = el('div', { className: 'game-stage' });
    hub.replaceChildren(el('div', { className: 'game-bar' }, [back, title]), stage);
    let ended = false;
    active = game.mount(stage, {
      makeFren,
      onEnd: ({ score }) => {
        if (ended) return;
        ended = true;
        const best = saveBest(game.id, score);
        window.dispatchEvent(new CustomEvent('tinyfrens-game-finished', { detail: { game: game.id, score, best } }));
        showResult(stage, game, score, best);
      }
    });
  }

  function showResult(stage, game, score, best) {
    const again = el('button', { type: 'button', textContent: 'Play again' });
    again.onclick = () => play(game);
    const back = el('button', { type: 'button', className: 'secondary', textContent: 'All games' });
    back.onclick = showPicker;
    const card = el('div', { className: 'game-result', role: 'status' }, [
      el('h3', { textContent: score >= best && score > 0 ? 'New best!' : 'Nice try!' }),
      el('p', { className: 'game-result-score', textContent: `★ ${score}` }),
      el('p', { className: 'small', textContent: `Best: ${best}` }),
      el('div', { className: 'actions' }, [again, back])
    ]);
    stage.append(card);
    again.focus({ preventScroll: true });
  }

  function stop() {
    if (active) { active.destroy(); active = null; }
  }

  function syncVisibility() {
    if (!screen || !active) return;
    if (screen.hidden || document.hidden) active.pause();
    else active.resume();
  }

  function init() {
    screen = document.getElementById('screen-games');
    hub = document.getElementById('gamesHub');
    if (!screen || !hub) return;
    new MutationObserver(() => { if (screen.hidden) showPicker(); }).observe(screen, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('visibilitychange', syncVisibility);
    showPicker();
  }

  window.TinyFrensGames = {
    register(game) {
      if (!game || !game.id || games.some(g => g.id === game.id)) return;
      games.push(game);
      if (hub && !active) showPicker();
    },
    list: () => games.slice(),
    bests
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
