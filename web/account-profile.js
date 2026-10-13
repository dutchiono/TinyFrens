'use strict';
(() => {
  const settings = document.getElementById('accountControls');
  if (!settings) return;
  const panel = document.createElement('section');
  panel.className = 'overlay account-profile';
  panel.innerHTML = `<h3>Profile</h3><p class="small">One name and the same wallets, NFTs, and settings across your linked devices.</p>
    <form id="accountProfileForm"><label for="accountDisplayName">Display name</label><input id="accountDisplayName" maxlength="32" autocomplete="nickname" placeholder="How people see you">
    <p id="accountXHandle" class="small"></p>
    <button type="submit">Save profile</button></form><div id="accountIdentities"></div><p id="accountProfileStatus" role="status"></p>
    <a class="telegram-account-link" href="https://t.me/TinyFrensBot?start=link" target="_blank" rel="noopener">DM @TinyFrensBot ↗</a>
    <p class="small">To link Telegram to this account, copy a code under Sync devices and DM <strong>/link CODE</strong> to @TinyFrensBot. Approve the request here.</p>`;
  settings.append(panel);
  const form = document.getElementById('accountProfileForm');
  const name = document.getElementById('accountDisplayName');
  const xHandle = document.getElementById('accountXHandle');
  const identities = document.getElementById('accountIdentities');
  const status = document.getElementById('accountProfileStatus');
  const base = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  const identity = () => window.TinyFrensFriends?.identity?.() || JSON.parse(localStorage.getItem('tinyfrens-device:' + base()) || 'null');
  async function request(values = {}) {
    const device = identity();
    if (!device?.token) throw Error('Your device is still connecting. Try again shortly.');
    return window.TinyFrensTurtleAPI(base(), '/api/account/profile', {token:device.token, ...values});
  }
  function draw(data) {
    name.value = data.displayName || '';
    xHandle.textContent = data.xHandle && data.xHandleSource === 'verified-identity'
      ? `X: @${data.xHandle} · verified`
      : 'X is not verified. X account verification is not available yet; handles cannot be entered manually.';
    window.dispatchEvent(new CustomEvent('tinyfrens-profile-updated', {detail:data}));
    identities.replaceChildren();
    for (const item of data.identities || []) {
      if (item.platform === 'x') continue;
      const row = document.createElement('p'); row.className = 'account-identity';
      const label = item.platform === 'telegram' ? 'Telegram' : item.platform;
      row.textContent = `${label}: ${item.handle ? '@' + item.handle : item.displayName || 'linked'}${item.verified ? ' · verified' : ''}`;
      identities.append(row);
    }
  }
  async function load() { try { draw(await request()); status.textContent = ''; } catch (error) { status.textContent = error.message; } }
  form.onsubmit = async event => {
    event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    try { draw(await request({displayName:name.value})); status.textContent = 'Profile saved for your linked devices.'; }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  window.addEventListener('tinyfrens-identity-ready', load);
  window.addEventListener('tinyfrens-account-synced', load);
  const reset = document.getElementById('resetDevice');
  const nativeApp = Boolean(window.PetAndroid || window.TinyFrensDesktop || window.PetIOS);
  reset.closest('section').hidden = nativeApp;
  reset.onclick = () => {
    if (!confirm('Reset TinyFrens in this browser? This clears its saved sign-in, NFT choices and settings. Other devices and your NFTs stay unchanged. Link another device first if you want to keep access to this account.')) return;
    document.getElementById('disconnectFriends')?.click();
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tinyfrens') || key.startsWith('pocket-familiar')) localStorage.removeItem(key);
    }
    location.replace(location.pathname + '#account');
    location.reload();
  };
  load();
})();
