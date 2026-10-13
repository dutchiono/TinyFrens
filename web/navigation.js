(() => {
  const host = document.getElementById('mainNavigation');
  if (!host) return;
  const source = document.currentScript.src;
  const web = file => new URL(file, source).href;
  const nativeApp = !!(window.PetAndroid || window.TinyFrensDesktop || window.PetIOS);
  const home = nativeApp ? web('index.html#pet') : location.protocol === 'file:' ? 'https://www.tinyfrens.lol/' : new URL('../', source).href;
  const inApp = !!document.getElementById('screen-pet');
  const page = host.dataset.page;
  const item = (screen, label) => inApp
    ? `<button id="tab-${screen}" type="button" data-screen="${screen}">${label}</button>`
    : `<a href="${web('index.html#' + screen)}">${label}</a>`;
  const link = (key, href, label) => `<a href="${href}"${page === key ? ' aria-current="page"' : ''}>${label}</a>`;
  host.innerHTML = `<div class="tf-header-frens" aria-hidden="true"></div><div class="tf-nav-inner"><div class="tf-nav-heading"><a class="tf-brand" href="${home}">tinyfrens<span aria-hidden="true">●</span></a><a class="tf-back" href="${home}"${page === 'home' || inApp ? ' hidden' : ''}>← Back</a></div>
    <nav class="tf-nav-links" aria-label="Main navigation">${link('home', home, 'Home')}${item('pet', 'My NFTs')}${link('gallery', web('gallery.html'), 'Gallery')}${link('vote', web('vote.html'), 'Vote')}${item('account', 'Account')}
    <details class="tf-more" id="moreMenu"><summary>More <span aria-hidden="true">⌄</span></summary><div class="tf-more-options">${item('games', 'Games')}${item('care', 'Care')}${item('party', 'Party')}${item('help', 'Help')}<a href="${new URL('../', source).protocol === 'file:' ? 'https://www.tinyfrens.lol/#install' : new URL('../#install', source).href}">Get the app</a></div></details></nav></div>`;
  host.querySelector('.tf-back').addEventListener('click', event => {
    if (inApp && window.showScreen) {
      event.preventDefault(); window.showScreen('pet'); return;
    }
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) {
      event.preventDefault(); history.back();
    }
  });
  if (nativeApp && inApp) for (const anchor of host.querySelectorAll(`a[href="${home}"]`)) anchor.addEventListener('click', event => {
    event.preventDefault(); window.showScreen?.('pet');
  });
  const march = document.createElement('script'); march.src = web('header-frens.js?v=4'); document.body.append(march);
  const more = document.getElementById('moreMenu');
  document.addEventListener('click', event => { if (!more.contains(event.target)) more.open = false; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && more.open) { more.open = false; more.querySelector('summary').focus(); }
  });
})();

// Shared outbound-link behavior, including links rendered after navigation loads.
(() => {
  const ownHosts = new Set(['tinyfrens.lol', 'www.tinyfrens.lol', location.hostname]);
  function outbound(anchor) {
    if (!anchor?.href) return null;
    try {
      const url = new URL(anchor.href, location.href);
      return ['http:', 'https:'].includes(url.protocol) && !ownHosts.has(url.hostname) ? url : null;
    } catch { return null; }
  }
  function prepare(anchor) {
    if (!outbound(anchor)) return;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  for (const anchor of document.querySelectorAll('a[href]')) prepare(anchor);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') prepare(record.target);
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('a[href]')) prepare(node);
        for (const anchor of node.querySelectorAll('a[href]')) prepare(anchor);
      }
    }
  }).observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['href']});
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    const url = outbound(anchor);
    if (!url) return;
    prepare(anchor);
    const tg = window.Telegram?.WebApp;
    if (tg?.initData && !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      if (url.hostname === 't.me') tg.openTelegramLink(url.href);
      else tg.openLink(url.href);
    }
  });
})();
