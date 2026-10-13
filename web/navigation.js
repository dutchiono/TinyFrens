(() => {
  const host = document.getElementById('mainNavigation');
  if (!host) return;
  const inApp = !!document.getElementById('screen-pet');
  const item = (screen, label) => inApp
    ? `<button id="tab-${screen}" type="button" data-screen="${screen}">${label}</button>`
    : `<a href="index.html#${screen}">${label}</a>`;
  host.innerHTML = `<div class="primary-tabs">${item('pet', 'My NFTs')}<a href="vote.html"${inApp ? '' : ' aria-current="page"'}>Vote</a></div>
    <details class="more-menu" id="moreMenu"><summary>More <span aria-hidden="true">⌃</span></summary>
    <div class="more-options">${item('care', 'Care')}${item('games', 'Games')}${item('party', 'Party')}${item('looks', 'Looks')}${item('settings', 'Settings')}</div></details>`;
  if (inApp) return; // The app screen controller handles its own menu events.
  const more = document.getElementById('moreMenu');
  document.addEventListener('click', event => { if (!more.contains(event.target)) more.open = false; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && more.open) { more.open = false; more.querySelector('summary').focus(); }
  });
})();
