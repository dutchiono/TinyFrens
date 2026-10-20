(() => {
  const host = document.getElementById('externalWalletPanel');
  if (!host) return;
  const panel = document.createElement('section'); panel.className = 'device-sync-panel';
  panel.innerHTML = `<h2>Link another device</h2><p>Share your wallets, screen Frens, community /show choices, sizes and movement settings. Copy a code from the device you want to use, then enter it on the other device.</p>
    <div class="sync-code-row"><button id="syncCode" class="sync-code-display" type="button" title="Copy this code">Connecting…</button><button id="createSyncCode" type="button" class="secondary">Get code / retry</button></div><div id="syncQR" class="connection-qr"></div><p id="syncExpiry" class="small"></p>
    <label for="enterSyncCode">Enter a code from your other device</label><div class="sync-code-row"><input id="enterSyncCode" autocomplete="off" spellcheck="false" placeholder="ABCD-EFGH-JKLM" maxlength="14"><button id="joinSync" type="button">Sync</button></div>
    <button id="scanSyncQR" type="button" class="secondary">Scan QR code</button><p class="small">You can also scan with your phone’s Camera app. Choose “Open this connection in the Android app” on the page it opens to link your installed app.</p><p id="syncStatus" role="status"></p><button id="leaveSync" type="button" class="secondary" hidden>Stop syncing this device</button>
    <dialog id="syncApproval" class="update-modal"><h2>Sync this device?</h2><p id="syncApprovalText"></p><p>Approve only if you just entered this code on your other device. This device’s NFT choices and settings will be used on both.</p><div class="actions"><button id="approveSync" type="button">Approve sync</button><button id="denySync" type="button" class="secondary">Cancel</button></div></dialog>
    <dialog id="communityLinkApproval" class="update-modal"><h2>Link this chat account?</h2><p id="communityLinkText"></p><p id="communityLinkWarning" class="small"></p><a id="openCommunityLinkApp" class="button" hidden>Open in the TinyFrens app</a><div class="actions"><button id="approveCommunityLink" type="button">Link account</button><button id="cancelCommunityLink" type="button" class="secondary">Cancel</button></div></dialog>`;
  document.getElementById('accountControls').append(panel);
  const $ = id => document.getElementById(id), key = window.TinyFrensCompanionKey;
  document.body.append($('syncApproval'));
  document.body.append($('communityLinkApproval'));
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
  let revision = null, baseline = null, telegramSelection = [], accountWallets = null, currentAccount = null, busy = false, applying = false, code = null, pending = null, denied = null;
  const telegramIdentity = nft => ({chainId:Number(nft.chainId), originalAddress:String(nft.originalAddress || '').toLowerCase(), tokenId:Number(nft.tokenId)});
  const setTelegramSelection = value => {
    const next = Array.isArray(value) ? value.slice().sort((a,b) => a.slot-b.slot) : [];
    if (JSON.stringify(next) === JSON.stringify(telegramSelection)) return;
    telegramSelection = next;
    window.dispatchEvent(new Event('tinyfrens-telegram-slots-changed'));
  };
  async function ensureState() {
    if (revision !== null) return;
    const data = await post('state');
    currentAccount = data.account; revision = data.revision;
    setTelegramSelection(data.telegramSelection);
  }
  async function setTelegramSlot(nft, requestedSlot) {
    const slot = Number(requestedSlot);
    if (!Number.isInteger(slot) || slot < 0 || slot > 5) throw Error('Choose /show through /show 5, or Not selected.');
    await ensureState();
    const identity = telegramIdentity(nft), nftKey = key(identity);
    const previous = telegramSelection.find(item => key(item) === nftKey);
    const occupant = slot ? telegramSelection.find(item => item.slot === slot && key(item) !== nftKey) : null;
    const next = telegramSelection.filter(item => key(item) !== nftKey && (!slot || item.slot !== slot));
    if (occupant && previous) next.push({...telegramIdentity(occupant), slot:previous.slot});
    if (slot) next.push({...identity, slot});
    busy = true;
    try {
      const data = await post('state', {revision, telegramSelection:next});
      revision = data.revision; setTelegramSelection(data.telegramSelection);
      $('syncStatus').textContent = slot ? `Saved for ${slot === 1 ? '/show' : `/show ${slot}`} in Telegram and Discord.` : 'Removed from community /show.';
      return slot;
    } finally { busy = false; }
  }
  window.TinyFrensTelegramSlots = {
    list: () => telegramSelection.map(item => ({...item})),
    slotFor: nft => telegramSelection.find(item => key(item) === key(nft))?.slot || 0,
    setSlot: setTelegramSlot,
  };
  const codeStorage = () => 'tinyfrens-sync-code:' + base() + ':' + (identity()?.id || '');
  try { code = JSON.parse(sessionStorage.getItem(codeStorage()) || 'null'); } catch {}
  const saveCode = () => { try { if (code) sessionStorage.setItem(codeStorage(), JSON.stringify(code)); else sessionStorage.removeItem(codeStorage()); } catch {} };
  function drawCode() {
    if (code && Date.now() >= code.expires * 1000) { code = null; saveCode(); }
    const remaining = code ? Math.max(0, Math.ceil(code.expires - Date.now() / 1000)) : 0;
    $('syncCode').textContent = code ? code.code.match(/.{1,4}/g).join('-') : 'Get a connection code';
    $('syncExpiry').textContent = code ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2,'0')}` : '';
    const url = code ? 'https://www.tinyfrens.lol/web/?sync-device=' + code.code + '#account' : '';
    if ($('syncQR').dataset.url !== url) { $('syncQR').dataset.url = url; window.TinyFrensQR.render($('syncQR'), url); }
  }
  setInterval(drawCode, 1000); drawCode();
  const incoming = new URLSearchParams(location.search).get('sync-device');
  if (/^[A-HJ-NP-Z2-9]{12}$/.test(incoming || '')) {
    $('enterSyncCode').value = incoming.match(/.{1,4}/g).join('-');
    window.showScreen?.('account');
    if (!window.PetAndroid) {
      const open = document.createElement('a'); open.textContent = 'Open this connection in the Android app';
      open.href = 'tinyfrens://connect?sync-device=' + incoming;
      $('enterSyncCode').closest('.sync-code-row').after(open);
    }
  }
  let incomingCommunityLink = new URLSearchParams(location.search).get('community-link');
  function clearCommunityLinkUrl() {
    const url = new URL(location.href); url.searchParams.delete('community-link');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    incomingCommunityLink = null;
  }
  async function openCommunityLink(linkToken) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(linkToken || '')) return;
    incomingCommunityLink = linkToken;
    window.showScreen?.('account');
    try {
      const [link, state] = await Promise.all([
        post('community-link/status', {linkToken}),
        post('state'),
      ]);
      const established = state.devices > 1 || state.addresses.length > 0 || state.selection.length > 0;
      $('communityLinkText').textContent = `${link.label} wants to use this TinyFrens account and its community slots.`;
      $('communityLinkWarning').textContent = established
        ? 'Only continue if this is the TinyFrens account you already use.'
        : 'This looks like a new browser. Open the link in your installed TinyFrens app or in the browser where your wallet and frens already appear.';
      $('approveCommunityLink').disabled = !established && !link.alreadyLinked;
      const appLink = $('openCommunityLinkApp');
      appLink.href = 'tinyfrens://connect?community-link=' + encodeURIComponent(linkToken);
      appLink.hidden = Boolean(window.PetAndroid || window.PetIOS || window.TinyFrensDesktop);
      if (!$('communityLinkApproval').open) $('communityLinkApproval').showModal();
    } catch (error) {
      $('syncStatus').textContent = error.message;
      clearCommunityLinkUrl();
    }
  }
  window.TinyFrensCommunityLink = {open:openCommunityLink};
  $('approveCommunityLink').onclick = async () => {
    $('approveCommunityLink').disabled = true;
    try {
      if (!incomingCommunityLink) throw Error('This account link expired. Run /link again.');
      await post('community-link/accept', {linkToken:incomingCommunityLink});
      clearCommunityLinkUrl(); $('communityLinkApproval').close();
      revision = null; baseline = null; await tick();
      $('syncStatus').textContent = 'Chat account linked. /show now uses your saved community slots.';
      window.dispatchEvent(new Event('tinyfrens-account-synced'));
    } catch (error) { $('communityLinkWarning').textContent = error.message; }
    finally { $('approveCommunityLink').disabled = false; }
  };
  $('cancelCommunityLink').onclick = () => { clearCommunityLinkUrl(); $('communityLinkApproval').close(); };
  $('scanSyncQR').onclick = async () => {
    try {
      const result = await window.TinyFrensQR.scan();
      if (!result) return;
      if (result.kind === 'sync-device') { $('enterSyncCode').value = result.code.match(/.{1,4}/g).join('-'); $('syncStatus').textContent = 'Code scanned. Tap Sync, then approve on the other device.'; }
      else location.href = result.url;
    } catch (error) { $('syncStatus').textContent = error.message; }
  };
  if (code) $('syncCode').textContent = code.code.match(/.{1,4}/g).join('-');
  const signature = items => JSON.stringify(items);
  async function apply(data) {
    applying = true;
    try {
      const token = identity().token;
      setTelegramSelection(data.telegramSelection);
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
      if (window.TinyFrensDesktop) { if (verified.length && !TinyFrensDesktop.isPetVisible()) TinyFrensDesktop.togglePet(); else if (!verified.length) TinyFrensDesktop.hidePet(); }
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
      setTelegramSelection(data.telegramSelection);
      if (revision === null && data.devices === 1 && data.revision === 0) {
        data = await post('state', {revision:0, selection:localSelection()});
        setTelegramSelection(data.telegramSelection);
        baseline = signature(localSelection()); revision = data.revision;
      } else if (revision !== data.revision) await apply(data);
      else if (baseline !== signature(localSelection())) {
        data = await post('state', {revision, selection:localSelection()});
        setTelegramSelection(data.telegramSelection);
        revision = data.revision; baseline = signature(localSelection());
      }
      const wallets = JSON.stringify(data.addresses);
      if (accountWallets !== wallets) { accountWallets = wallets; window.dispatchEvent(new Event('tinyfrens-account-synced')); }
      $('leaveSync').hidden = data.devices < 2;
      if (pending?.joining) {
        try { await post('status', {code:pending.code}); }
        catch (error) { if (error.message.includes('Code expired or not found')) { pending = null; $('syncStatus').textContent = 'Sync request expired or was cancelled. Create a new code and try again.'; } }
      }
      if (!pending) $('syncStatus').textContent = data.devices > 1 ? `Synced across ${data.devices} devices.` : 'This device is not synced yet.';
      if (code && Date.now() >= code.expires * 1000) { code = null; saveCode(); $('syncCode').textContent = 'Code expired'; $('createSyncCode').hidden=false; }
      if (code) {
        try {
          const request = await post('status', {code:code.code});
          if (request.pending && request.requestId !== denied) {
            pending = request; $('syncApprovalText').textContent = `${request.label} is requesting to sync using ${code.code.match(/.{1,4}/g).join('-')}.`;
            if (!$('syncApproval').open) $('syncApproval').showModal();
          }
        } catch (error) {
          if (error.message.includes('Code expired or not found')) { code = null; saveCode(); drawCode(); }
          $('syncStatus').textContent = error.message + ' Retry when connected.';
        }
      }
    } catch (error) { $('syncStatus').textContent = error.message; }
    finally { busy = false; }
  }
  $('syncCode').onclick = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code.code.match(/.{1,4}/g).join('-')); $('syncStatus').textContent='Copied. Enter this code on your other device.'; } catch { $('syncStatus').textContent='Enter the displayed code on your other device.'; }
  };
  async function createCode(renew = false) {
    if ($('createSyncCode').disabled) return;
    $('createSyncCode').disabled = true;
    try {
      code = await post('start', {renew}); saveCode(); pending = null; denied = null;
      const formatted = code.code.match(/.{1,4}/g).join('-'); $('syncCode').textContent = formatted;
      $('syncStatus').textContent = 'Tap the code to copy. Enter it on your other device, then approve here.';
      $('createSyncCode').textContent = 'Get a new code'; drawCode();
    } catch (error) { $('syncStatus').textContent = error.message; $('createSyncCode').textContent = 'Retry connection'; }
    finally { $('createSyncCode').disabled = false; }
  }
  $('createSyncCode').onclick = () => createCode(true);
  let preparingCode=false;
  const prepareCode=async()=>{if(code||preparingCode)return;preparingCode=true;try{await createCode();}finally{preparingCode=false;}};
  window.addEventListener('tinyfrens-identity-ready',()=>setTimeout(prepareCode,500));
  if(identity()?.token)setTimeout(prepareCode,500);
  $('joinSync').onclick = async () => {
    const button = $('joinSync'); button.disabled = true;
    try {
      const value = $('enterSyncCode').value.replace(/[-\s]/g, '').toUpperCase();
      if (!/^[A-HJ-NP-Z2-9]{12}$/.test(value)) throw Error('Enter the 12-character code from your other device.');
      const label = window.PetAndroid ? 'Your Android app' : window.TinyFrensDesktop ? 'Your desktop app' : window.PetIOS ? 'Your iPhone app' : 'Your browser';
      await post('request', {code:value, label}); pending = {joining:true, code:value};
      $('syncStatus').textContent = 'Approve the sync on the device that generated the code.';
    } catch (error) { $('syncStatus').textContent = error.message; }
    finally { button.disabled = false; }
  };
  $('approveSync').onclick = async () => {
    $('approveSync').disabled = true;
    try {
      if (!code || !pending?.requestId) throw Error('This request expired. Get a new code and try again.');
      await post('accept', {code:code.code, requestId:pending.requestId});
      code = null; saveCode(); pending = null; $('syncApproval').close(); $('syncCode').textContent = ''; await tick();
    } catch (error) { $('syncApprovalText').textContent = error.message; }
    finally { $('approveSync').disabled = false; }
  };
  const deny = async () => { denied = pending?.requestId; pending = null; $('syncApproval').close(); code = null; saveCode(); drawCode(); await createCode(true); };
  $('denySync').onclick = deny;
  $('syncApproval').addEventListener('cancel', event => { event.preventDefault(); deny(); });
  $('leaveSync').onclick = async () => { try { await post('leave'); pending = null; await tick(); } catch (error) { $('syncStatus').textContent = error.message; } };
  window.addEventListener('tinyfrens-identity-ready', tick);
  window.addEventListener('tinyfrens-identity-ready', () => { if (incomingCommunityLink) openCommunityLink(incomingCommunityLink); });
  window.addEventListener('online', tick);
  window.addEventListener('online', prepareCode);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  setInterval(tick, 3000); tick();
  if (incomingCommunityLink && identity()?.token) setTimeout(() => openCommunityLink(incomingCommunityLink), 500);
})();
