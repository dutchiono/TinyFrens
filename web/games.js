// Shared game lifecycle, NFT player selection and the existing care engine.
(() => {
  const BEST_KEY = 'tinyfrens-games-v1', PLAYER_KEY = 'tinyfrens-game-player';
  const games = [];
  let hub, screen, active, generation = 0, player = null;
  const players = () => window.TinyFrensGamePlayers;
  function el(tag, props, children = []) { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; }
  function bests() { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch { return {}; } }
  function saveBest(id, score) { const all = bests(), best = Math.max(Number(all[id]) || 0, score); all[id] = best; localStorage.setItem(BEST_KEY, JSON.stringify(all)); return best; }
  function stop() { generation++; active?.destroy(); active = null; }
  async function showPicker() {
    stop(); if (!hub || screen.hidden) return;
    const current = generation;
    const status = el('p', {className:'small', role:'status', textContent:'Finding your NFT players…'});
    const select = el('select', {id:'gamePlayer', disabled:true});
    const preview = el('img', {className:'game-player-preview', alt:'', hidden:true});
    const label = el('label', {htmlFor:'gamePlayer', textContent:'Your player'});
    const list = el('div', {className:'games-list'});
    const buttons = games.map(game => {
      const button = el('button', {type:'button', className:'game-card', disabled:true}, [
        el('span', {className:'game-card-emoji', textContent:game.emoji}),
        el('span', {className:'game-card-text'}, [el('strong', {textContent:game.title}), el('small', {textContent:game.blurb}), el('small', {textContent:'Best: ' + (bests()[game.id] || 0)})])]);
      button.onclick = () => play(game, status); list.append(button); return button;
    });
    const refresh = el('button', {type:'button', className:'secondary', textContent:'Refresh NFTs'}); refresh.onclick = () => { players().clear(); showPicker(); };
    const connect = el('button', {type:'button', className:'secondary', textContent:'Manage wallets'}); connect.onclick = () => window.showScreen('wallet');
    hub.replaceChildren(el('div', {className:'game-player-picker'}, [preview, label, select]), status, list, el('div', {className:'actions'}, [connect, refresh]));
    try {
      const data = await players().list(); if (generation !== current) return;
      player = null;
      for (const nft of data.items) select.append(el('option', {value:players().key(nft), textContent:nft.name + ' · ' + nft.collection}));
      select.disabled = !data.items.length;
      const saved = localStorage.getItem(PLAYER_KEY); if (data.items.some(nft => players().key(nft) === saved)) select.value = saved;
      select.onchange = () => {
        player = data.items.find(nft => players().key(nft) === select.value);
        localStorage.setItem(PLAYER_KEY, select.value);
        preview.hidden = !player?.image; preview.src = player?.image || ''; preview.alt = player?.name || '';
        buttons.forEach(button => button.disabled = !player);
      };
      select.onchange();
      status.textContent = (data.items.length ? 'Choose an NFT, then start a game.' : 'Connect a wallet holding a supported animated NFT to play.') + (data.partial ? ' Some collections could not be checked. ' + data.errors.join(' ') : '');
    } catch (error) { if (generation === current) status.textContent = error.message; }
  }
  async function play(game) {
    if (!player) return;
    const chosen = player; stop(); const current = generation;
    hub.querySelectorAll('button,select').forEach(node => node.disabled = true);
    const status = el('p', {role:'status', textContent:'Checking your NFT and preparing its animation…'}); hub.append(status);
    try {
      const nft = await players().prepare(chosen); if (generation !== current || screen.hidden) return;
      const permission = window.TinyFrensGameCare.canPlay();
      if (permission.blocked) throw Error(permission.feedback);
      if (!window.TinyFrensRobotCare || !(await window.TinyFrensRobotCare.beforeGame())) {
        throw Error('A verified Robot and enough account Energy are required to start a game.');
      }
      const sprite = players().sprite(nft);
      const back = el('button', {type:'button', className:'secondary game-back', textContent:'← Games'}); back.onclick = showPicker;
      const stage = el('div', {className:'game-stage'});
      hub.replaceChildren(el('div', {className:'game-bar'}, [back, el('h2', {className:'game-title', textContent:game.title})]), el('p', {className:'small', textContent:nft.name}), stage);
      let ended = false;
      active = game.mount(stage, {
        makeFren: () => sprite.element,
        updatePlayer: (time, moving, direction) => sprite.update(time, moving, direction),
        onError: error => { if (generation === current) { stop(); hub.replaceChildren(el('p', {role:'alert', textContent:error.message}), back); } },
        onEnd: ({score, duration}) => {
          if (ended || generation !== current) return; ended = true;
          const best = saveBest(game.id, score);
          const care = duration >= 15 && score > 0 ? window.TinyFrensGameCare.complete() : null;
          window.dispatchEvent(new CustomEvent('tinyfrens-game-finished', {detail:{game:game.id, score, best, player:players().key(nft), duration}}));
          const again = el('button', {type:'button', textContent:'Play again'}); again.onclick = () => play(game);
          const card = el('div', {className:'game-result', role:'status'}, [el('h3', {textContent:score >= best && score > 0 ? 'New best!' : 'Round complete'}), el('p', {className:'game-result-score', textContent:'★ ' + score}), el('p', {className:'small', textContent:'Best: ' + best}), el('p', {className:'small', textContent:care?.feedback || game.careHint || 'Play for 15 seconds and score to earn the usual Play care effect.'}), again]);
          stage.append(card); again.focus({preventScroll:true});
        }
      });
    } catch (error) {
      if (generation !== current) return;
      status.textContent = error.message; hub.querySelectorAll('button,select').forEach(node => node.disabled = false);
    }
  }
  function visibility() { if (!active) return; if (screen.hidden || document.hidden) active.pause(); else active.resume(); }
  function init() {
    screen = document.getElementById('screen-games'); hub = document.getElementById('gamesHub'); if (!screen || !hub) return;
    new MutationObserver(() => { if (screen.hidden) stop(); else showPicker(); }).observe(screen, {attributes:true, attributeFilter:['hidden']});
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('tinyfrens-account-synced', () => { if (!screen.hidden) showPicker(); });
    showPicker();
  }
  window.TinyFrensGames = {register(game) { if (game?.id && !games.some(item => item.id === game.id)) { games.push(game); if (hub && !active) showPicker(); } }, list:() => games.slice(), bests};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
