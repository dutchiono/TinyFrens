(() => {
  const host = document.getElementById('mainNavigation');
  if (!host) return;
  const source = document.currentScript.src;
  const web = file => new URL(file, source).href;
  const home = location.protocol === 'file:' ? 'https://www.tinyfrens.lol/' : new URL('../', source).href;
  const inApp = !!document.getElementById('screen-pet');
  const page = host.dataset.page;
  const item = (screen, label) => inApp
    ? `<button id="tab-${screen}" type="button" data-screen="${screen}">${label}</button>`
    : `<a href="${web('index.html#' + screen)}">${label}</a>`;
  const link = (key, href, label) => `<a href="${href}"${page === key ? ' aria-current="page"' : ''}>${label}</a>`;
  host.innerHTML = `<div class="tf-nav-inner"><div class="tf-nav-heading"><a class="tf-brand" href="${home}">tinyfrens<span aria-hidden="true">●</span></a><a class="tf-back" href="${home}"${page === 'home' ? ' hidden' : ''}>← Back</a></div>
    <nav class="tf-nav-links" aria-label="Main navigation">${link('home', home, 'Home')}${item('pet', 'My NFTs')}${link('gallery', web('gallery.html'), 'Gallery')}${link('vote', web('vote.html'), 'Vote')}
    <details class="tf-more" id="moreMenu"><summary>More <span aria-hidden="true">⌄</span></summary><div class="tf-more-options">${item('care', 'Care')}${item('party', 'Party')}${item('looks', 'Looks')}${item('settings', 'Settings')}<a href="${home}#install">Get the app</a></div></details></nav></div>`;
  host.querySelector('.tf-back').addEventListener('click', event => {
    if (inApp && location.hash && !['#pet', '#wallet'].includes(location.hash) && window.showScreen) {
      event.preventDefault(); window.showScreen('pet'); return;
    }
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) {
      event.preventDefault(); history.back();
    }
  });
  const more = document.getElementById('moreMenu');
  document.addEventListener('click', event => { if (!more.contains(event.target)) more.open = false; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && more.open) { more.open = false; more.querySelector('summary').focus(); }
  });
})();
