'use strict';
(() => {
  const settings = document.getElementById('settingsPanel');
  if (!settings) return;
  const panel = document.createElement('section');
  panel.className = 'overlay account-profile';
  panel.innerHTML = `<h2>Your account</h2><p class="small">One name and the same wallets, NFTs, and settings across your linked devices.</p>
    <form id="accountProfileForm"><label for="accountDisplayName">Display name</label><input id="accountDisplayName" maxlength="32" autocomplete="nickname" placeholder="How people see you">
    <label for="accountXHandle">X handle · optional</label><input id="accountXHandle" maxlength="31" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="@handle"><p class="small">Telegram handles are verified automatically. X verification needs a trusted Bankr identity callback; for now this is your chosen profile handle.</p>
    <button type="submit">Save profile</button></form><div id="accountIdentities"></div><p id="accountProfileStatus" role="status"></p>
    <a class="telegram-account-link" href="https://t.me/TinyFrensBot?start=link" target="_blank" rel="noopener">DM @TinyFrensBot ↗</a>
    <p class="small">To link Telegram to this account, copy a code under Sync devices and DM <strong>/link CODE</strong> to @TinyFrensBot. Approve the request here.</p>`;
  settings.prepend(panel);
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
    xHandle.value = data.xHandle ? '@' + data.xHandle : '';
    identities.replaceChildren();
    for (const item of data.identities || []) {
      const row = document.createElement('p'); row.className = 'account-identity';
      const label = item.platform === 'telegram' ? 'Telegram' : item.platform;
      row.textContent = `${label}: ${item.handle ? '@' + item.handle : item.displayName || 'linked'}${item.verified ? ' · verified' : ''}`;
      identities.append(row);
    }
  }
  async function load() { try { draw(await request()); status.textContent = ''; } catch (error) { status.textContent = error.message; } }
  form.onsubmit = async event => {
    event.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    try { draw(await request({displayName:name.value, xHandle:xHandle.value})); status.textContent = 'Profile saved for your linked devices.'; }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  window.addEventListener('tinyfrens-identity-ready', load);
  window.addEventListener('tinyfrens-account-synced', load);
  load();
})();
