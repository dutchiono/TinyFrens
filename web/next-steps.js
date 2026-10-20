// Points new holders to the next useful step: connect a wallet, mint, show a fren, then play.
(() => {
  const host = document.getElementById('frensNextStep');
  const gallery = 'gallery.html';
  const el = (tag, props = {}, children = []) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
  function shownCount() {
    try {
      const bridge = window.PetAndroid || window.TinyFrensDesktop;
      const items = bridge?.getTurtle ? JSON.parse(bridge.getTurtle()).items || [] : JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]');
      return items.filter(nft => nft.active !== false && Date.now() < nft.validUntil * 1000).length;
    } catch { return 0; }
  }
  function stage() {
    const wallet = window.TinyFrensWalletState;
    if (!wallet || (!wallet.loaded && !wallet.failed)) return 'checking';
    if (!wallet.addresses.length) return 'connect';
    if (shownCount()) return 'ready';
    if (wallet.nfts === null) return wallet.scanError ? 'scan-failed' : 'scanning';
    return wallet.nfts ? 'show' : 'mint';
  }
  const go = screen => () => window.showScreen?.(screen);
  const refresh = () => document.getElementById('scanWallet')?.click();
  const chooseFren = () => document.getElementById('supportedNFTPanel')?.scrollIntoView({behavior:'smooth', block:'start'});
  const steps = {
    checking: {title:'Checking your account…'},
    connect: {step:'Step 1 of 3', title:'Connect the wallet that holds your TinyFrens', text:'Use Bankr or your wallet app. Already set up on another device? Link it from Account instead.', actions:[['Link another device', go('account')], ['No robot yet? Mint one', gallery]], wallet:true},
    scanning: {title:'Looking for your NFTs…'},
    'scan-failed': {title:'Could not check your NFTs', text:'Your wallet is connected, but the collection check did not finish.', actions:[['Try again', refresh]]},
    mint: {step:'Step 2 of 3', title:'Get your first TinyFren', text:'None of your connected wallets hold a supported NFT yet. Mint a Robots v1 in the Gallery, then refresh here.', actions:[['Mint in the Gallery', gallery], ['Refresh', refresh], ['Add another wallet', go('account')]]},
    show: {step:'Step 3 of 3', title:'Bring your fren onto this device', text:'Turn on Screen for an NFT in your collection below.', actions:[['Choose a fren', chooseFren]]},
    ready: {title:'Your fren is here', text:'Look after it, meet other frens in the Plaza, or play a game.', actions:[['Care', go('care')], ['Plaza', go('party')], ['Games', go('games')]]},
  };
  function card(info, compact) {
    const actions = (info.actions || []).map(([label, action], index) => typeof action === 'string'
      ? el('a', {className:'next-step-link' + (index || info.wallet ? '' : ' primary'), href:action, textContent:label})
      : el('button', {type:'button', className:index || info.wallet ? 'secondary' : '', textContent:label, onclick:action}));
    return el('div', {className:'next-step' + (compact ? ' compact' : '')}, [
      ...(info.step ? [el('p', {className:'next-step-count', textContent:info.step})] : []),
      el(compact ? 'h3' : 'h2', {textContent:info.title}),
      ...(info.text ? [el('p', {textContent:info.text})] : []),
      ...(actions.length ? [el('div', {className:'actions'}, actions)] : [])]);
  }
  const forGames = {
    connect: {title:'Connect a wallet to pick a player', text:'Games use the NFTs in your connected wallets.', actions:[['Connect on Frens', go('pet')], ['No robot yet? Mint one', gallery]]},
    mint: {title:'Get a TinyFren to play with', text:'None of your connected wallets hold a supported NFT yet.', actions:[['Mint in the Gallery', gallery], ['Back to Frens', go('pet')]]},
  };
  let current = '';
  function render() {
    if (!host) return;
    const next = stage();
    if (next === current) return;
    current = next;
    const info = steps[next];
    const manager = document.getElementById('walletManager');
    const box = card(info);
    if (manager) {
      if (info.wallet) { manager.open = true; box.insertBefore(manager, box.querySelector('.actions')); }
      else if (host.contains(manager)) document.getElementById('accountControls')?.prepend(manager);
    }
    host.replaceChildren(box);
  }
  window.TinyFrensNextStep = {
    stage,
    guide: () => { const info = forGames[stage()]; return info ? card(info, true) : null; },
  };
  for (const event of ['tinyfrens-wallet-state', 'tinyfrens-wallet-link-changed', 'storage']) window.addEventListener(event, render);
  window.TinyFrensDesktop?.onTurtle?.(render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  render();
})();
