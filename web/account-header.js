(() => {
  'use strict';
  const heading = document.querySelector('#mainNavigation .tf-nav-heading');
  if (!heading) return;
  const source = document.currentScript.src;
  const account = document.createElement('a');
  account.className = 'tf-account-summary';
  account.href = new URL('index.html#account', source).href;
  account.innerHTML = '<span class="tf-account-name">Your account</span><span class="tf-account-balance">— FRENS</span>';
  account.title = 'Account and available care/game balance';
  heading.append(account);
  account.addEventListener('click', event => {
    if (document.getElementById('screen-account') && window.showScreen) {
      event.preventDefault(); window.showScreen('account');
    }
  });
  const name = account.querySelector('.tf-account-name');
  const balance = account.querySelector('.tf-account-balance');
  const base = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  function identity() {
    try { return window.TinyFrensFriends?.identity?.() || JSON.parse(localStorage.getItem('tinyfrens-device:' + base()) || 'null'); }
    catch { return null; }
  }
  function drawProfile(data) {
    name.textContent = data.displayName || data.identities?.find(item => item.verified && item.displayName)?.displayName || 'Your account';
    name.title = name.textContent;
  }
  let generation = 0, lastToken = null;
  async function refresh() {
    const current = ++generation;
    const device = identity();
    if (lastToken !== device?.token) {
      name.textContent = 'Your account';
      balance.textContent = '— FRENS';
      lastToken = device?.token;
    }
    if (!device?.token) { balance.title = 'Connect your account to see your FRENS balance'; return; }
    const results = await Promise.allSettled([
      window.TinyFrensTurtleAPI(base(), '/api/account/profile', {token:device.token}),
      window.TinyFrensTurtleAPI(base(), '/api/credits/balance', {token:device.token}),
    ]);
    if (current !== generation || device.token !== identity()?.token) return;
    if (results[0].status === 'fulfilled') drawProfile(results[0].value);
    if (results[1].status === 'fulfilled') {
      const data = results[1].value;
      if (Number.isFinite(data.balance) && Number.isFinite(data.creditsPerFrens) && data.creditsPerFrens > 0) {
        balance.textContent = (data.balance / data.creditsPerFrens).toLocaleString('en-US', {maximumFractionDigits:2}) + ' FRENS';
        balance.title = 'Available FRENS for care and games';
        return;
      }
    }
    balance.textContent = 'FRENS unavailable';
    balance.title = 'Could not load your balance. Open your account or reconnect to retry.';
  }
  function load(file) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = new URL(file, source).href;
      script.onload = resolve; script.onerror = reject; document.body.append(script);
    });
  }
  async function start() {
    if (!window.TINYFRENS_SERVER) await load('social-config.js');
    if (!window.TinyFrensTurtleAPI) await load('turtle-api.js');
    for (const event of ['tinyfrens-identity-ready', 'tinyfrens-account-synced', 'tinyfrens-wallet-link-changed', 'tinyfrens-balance-updated', 'focus', 'storage']) window.addEventListener(event, refresh);
    window.addEventListener('tinyfrens-profile-updated', event => drawProfile(event.detail));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    await refresh();
  }
  start().catch(() => { balance.textContent = 'FRENS unavailable'; });
})();
