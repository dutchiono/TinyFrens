(() => {
  const host = document.getElementById('externalWalletPanel');
  if (!host) return;
  const panel = document.createElement('details'); panel.className = 'device-sync-panel';
  panel.innerHTML = `<summary>Sync devices</summary><p>Share your wallets, shown NFTs, sizes and movement settings. Copy a code from the device you want to use, then enter it on the other device.</p>
    <div class="sync-code-row"><button id="createSyncCode" type="button" class="secondary">Copy a sync code</button><output id="syncCode"></output></div>
    <label for="enterSyncCode">Code from your other device</label><div class="sync-code-row"><input id="enterSyncCode" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH-JKLM" maxlength="14"><button id="joinSync" type="button">Sync</button></div>
    <p id="syncStatus" role="status"></p><button id="leaveSync" type="button" class="secondary" hidden>Stop syncing this device</button>
    <dialog id="syncApproval" class="update-modal"><h2>Sync this device?</h2><p id="syncApprovalText"></p><p>Approve only if you just entered this code on your other device. This device’s NFT choices and settings will be used on both.</p><div class="actions"><button id="approveSync" type="button">Approve sync</button><button id="denySync" type="button" class="secondary">Cancel</button></div></dialog>`;
  host.before(panel);
  const $ = id => document.getElementById(id), key = window.TinyFrensCompanionKey;
  document.body.append($('syncApproval'));
  const storage = 'tinyfrens-companions', motionStorage = 'tinyfrens-companion-motion';
  const base = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  const native = window.PetAndroid || window.TinyFrensDesktop;
  const identity = () => window.TinyFrensFriends?.identity?.() || JSON.parse(localStorage.getItem('tinyfrens-device:' + base()) || 'null');
  const post = (path, body = {}) => {
    const device = identity(); if (!device?.token) throw Error('Your device is still connecting. Try again shortly.');
    return window.TinyFrensTurtleAPI(base(), '/api/device-sync/' + path, {token:device.token, ...body});
  };
  function localSelection() {
    const view = native?.getTurtle ? JSON.parse(native.getTurtle()) : null;
    if (view?.pendingExpired) throw Error('Refreshing ownership before syncing your NFTs…');
    const items = view ? view.items || [] : JSON.parse(localStorage.getItem(storage) || '[]');
    const motions = JSON.parse(localStorage.getItem(motionStorage) || '{}');
    return items.filter(n => n.active !== false).map(n => {
      const motion = motions[key(n)] || n.motion || {};
      return {chainId:n.chainId, originalAddress:n.originalAddress.toLowerCase(), tokenId:n.tokenId,
        motion:{mode:motion.mode || 'roam', speed:motion.speed || 60, size:motion.size || 80}};
    });
  }
  let revision = null, baseline = null, accountWallets = null, currentAccount = null, busy = false, applying = false, code = null, pending = null, denied = null;
  try { code = JSON.parse(sessionStorage.getItem('tinyfrens-sync-code') || 'null'); } catch {}
  const saveCode = () => { try { if (code) sessionStorage.setItem('tinyfrens-sync-code', JSON.stringify(code)); else sessionStorage.removeItem('tinyfrens-sync-code'); } catch {} };
  if (code) $('syncCode').textContent = code.code.match(/.{1,4}/g).join('-');
  const signature = items => JSON.stringify(items);
  async function apply(data) {
    applying = true;
    try {
      const token = identity().token;
      // Each device verifies ownership itself; synced choices never grant display rights.
      const verified = [];
      for (const item of data.selection) {
        const nft = await window.TinyFrensTurtleAPI(base(), '/api/featured/companion', {token, ...item});
        if (nft.active && nft.companion && Date.now() < nft.validUntil * 1000) verified.push({...nft, motion:item.motion});
      }
      if (native?.turtleRequest) {
        const old = JSON.parse(native.getTurtle()).items || [];
        for (const nft of old) if (!verified.some(n => key(n) === key(nft)))
          await window.TinyFrensTurtleAPI(base(), '/native/remove-turtle', {tokenId:nft.tokenId, chainId:nft.chainId, originalAddress:nft.originalAddress});
        for (const nft of verified) {
          const selection = {tokenId:nft.tokenId, chainId:nft.chainId, originalAddress:nft.originalAddress};
          if (!old.some(n => key(n) === key(nft))) await window.TinyFrensTurtleAPI(base(), '/native/import-turtle', {token, ...selection});
          await window.TinyFrensTurtleAPI(base(), '/native/companion-motion', {...selection, ...nft.motion});
        }
      }
      localStorage.setItem(storage, JSON.stringify(verified));
      const motions = JSON.parse(localStorage.getItem(motionStorage) || '{}');
      for (const nft of verified) motions[key(nft)] = nft.motion;
      localStorage.setItem(motionStorage, JSON.stringify(motions));
      if (window.PetAndroid) { if (verified.length) PetAndroid.startPet(); else PetAndroid.stopPet(); }
      if (window.TinyFrensDesktop && verified.length && !TinyFrensDesktop.isPetVisible()) TinyFrensDesktop.togglePet();
      window.dispatchEvent(new Event('tinyfrens-wallet-link-changed'));
      baseline = signature(localSelection()); revision = data.revision;
    } finally { applying = false; }
  }
  async function tick() {
    if (busy || applying || document.hidden || !identity()?.token) return;
    busy = true;
    try {
      let data = await post('state');
      if (pending?.joining && currentAccount && data.account !== currentAccount) pending = null;
      currentAccount = data.account;
      if (revision === null && data.devices === 1 && data.revision === 0) {
        data = await post('state', {revision:0, selection:localSelection()});
        baseline = signature(localSelection()); revision = data.revision;
      } else if (revision !== data.revision) await apply(data);
      else if (baseline !== signature(localSelection())) {
        data = await post('state', {revision, selection:localSelection()});
        revision = data.revision; baseline = signature(localSelection());
      }
      const wallets = JSON.stringify(data.addresses);
      if (accountWallets !== wallets) { accountWallets = wallets; window.dispatchEvent(new Event('tinyfrens-account-synced')); }
      $('leaveSync').hidden = data.devices < 2;
      if (!pending) $('syncStatus').textContent = data.devices > 1 ? `Synced across ${data.devices} devices.` : 'This device is not synced yet.';
      if (code && Date.now() >= code.expires * 1000) { code = null; saveCode(); $('syncCode').textContent = 'Code expired'; }
      if (code) {
        try {
          const request = await post('status', {code:code.code});
          if (request.pending && request.requestId !== denied) {
            pending = request; $('syncApprovalText').textContent = `${request.label} is requesting to sync using ${code.code.match(/.{1,4}/g).join('-')}.`;
            if (!$('syncApproval').open) $('syncApproval').showModal();
          }
        } catch (error) { code = null; saveCode(); $('syncCode').textContent = ''; }
      }
    } catch (error) { $('syncStatus').textContent = error.message; }
    finally { busy = false; }
  }
  $('createSyncCode').onclick = async () => {
    try {
      await tick(); if (busy || revision === null) throw Error('Wait for your device to finish connecting.');
      code = await post('start'); saveCode(); pending = null; denied = null;
      const formatted = code.code.match(/.{1,4}/g).join('-'); $('syncCode').textContent = formatted;
      try { await navigator.clipboard.writeText(formatted); $('syncStatus').textContent = 'Copied. Paste on your other device, then approve here.'; }
      catch { $('syncStatus').textContent = 'Enter the code shown here on your other device.'; }
    } catch (error) { $('syncStatus').textContent = error.message; }
  };
  $('joinSync').onclick = async () => {
    const button = $('joinSync'); button.disabled = true;
    try {
      const value = $('enterSyncCode').value.replace(/[-\s]/g, '').toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{12}$/.test(value)) throw Error('Enter the 12-character code from your other device.');
      const label = window.PetAndroid ? 'Your Android app' : window.TinyFrensDesktop ? 'Your desktop app' : window.PetIOS ? 'Your iPhone app' : 'Your browser';
      await post('request', {code:value, label}); pending = {joining:true};
      $('syncStatus').textContent = 'Approve the sync on the device that generated the code.';
    } catch (error) { $('syncStatus').textContent = error.message; }
    finally { button.disabled = false; }
  };
  $('approveSync').onclick = async () => {
    $('approveSync').disabled = true;
    try {
      await tick(); await post('accept', {code:code.code, requestId:pending.requestId});
      code = null; saveCode(); pending = null; $('syncApproval').close(); $('syncCode').textContent = ''; await tick();
    } catch (error) { $('syncApprovalText').textContent = error.message; }
    finally { $('approveSync').disabled = false; }
  };
  const deny = async () => { denied = pending?.requestId; pending = null; $('syncApproval').close(); code = null; saveCode(); $('syncCode').textContent = ''; try { await post('start'); } catch {} };
  $('denySync').onclick = deny;
  $('syncApproval').addEventListener('cancel', event => { event.preventDefault(); deny(); });
  $('leaveSync').onclick = async () => { try { await post('leave'); pending = null; await tick(); } catch (error) { $('syncStatus').textContent = error.message; } };
  window.addEventListener('tinyfrens-identity-ready', tick);
  window.addEventListener('online', tick);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tick, 3000); tick();
})();
