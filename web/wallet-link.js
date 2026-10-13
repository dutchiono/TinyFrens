(() => {
  const target = document.getElementById('externalWalletPanel');
  if (!target) return;
  // Navigation later normalizes the hash to #pet; retain the incoming pairing code.
  const installedApp = Boolean(window.PetAndroid || window.TinyFrensDesktop || window.PetIOS);
  const remoteDeviceCode = new URLSearchParams(location.hash.slice(1)).get('connect-device') || '';
  target.innerHTML = `
    <details id="walletManager" class="wallet-manager" open><summary>Add wallets</summary>
    <section class="overlay wallet-link-panel" style="margin-top:0;">
      <div id="linkedWallet" class="wallet-link-address"></div>
      <div class="bankr-connect">
        <h4>Connect with Bankr</h4>
        <p class="small">Click to copy · Send to Bankr · Approve here</p>
        <p id="bankrWalletPrompt" role="button" tabindex="0" aria-label="Copy Bankr connection message">Connecting to your account…</p>
        <div class="actions"><button type="button" id="acceptWalletPairing" hidden>Approve wallet</button></div>
        <p id="walletPairingStatus" role="status"></p>
        <button type="button" id="renewWalletPairing" class="secondary pairing-renew">New connection code</button>
      </div>
      <div class="manual-wallet"><button type="button" id="linkWallet" class="secondary">Connect wallet manually</button><span class="small">Sign a read-only message.</span><a id="connectInBrowser" hidden target="_blank" rel="noopener noreferrer">Sign in browser, then return to this app ↗</a></div>
      <p id="walletLinkStatus" role="status"></p><p id="deviceConnectCode" class="small"></p>
    </section></details>
    <section id="supportedNFTPanel" class="overlay wallet-link-panel" hidden>
      <div class="collection-toolbar"><h2>Your collection</h2><button type="button" id="scanWallet" class="secondary" disabled>Refresh</button></div>
      <label class="nft-search">Find an NFT<input id="nftSearch" type="search" placeholder="Name, collection or token number"></label>
      <div id="walletMatches" class="wallet-nfts" aria-live="polite"></div>
      <p id="walletScanStatus" role="status"></p>
    </section>

  `;

  const linkedWallet = document.getElementById('linkedWallet');
  const linkButton = document.getElementById('linkWallet');
  const scanButton = document.getElementById('scanWallet');
  const linkStatus = document.getElementById('walletLinkStatus');
  const scanStatus = document.getElementById('walletScanStatus');
  const matches = document.getElementById('walletMatches');
  const base = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  let linkedAddresses = [];
  const manager = document.getElementById('walletManager');
  document.getElementById('accountControls').prepend(manager);


  function identity() {
    const current = window.TinyFrensFriends?.identity?.() || JSON.parse(localStorage.getItem('tinyfrens-device:' + base()) || 'null');
    if (!current?.token) throw new Error('Your fren is still connecting. Try again in a moment.');
    return current;
  }

  async function post(path, values = {}) {
    return window.TinyFrensTurtleAPI(base(), path, {token:identity().token, ...values});
  }

  function showLink(addresses = []) {
    linkedAddresses = addresses;
    const approvingDevice = Boolean(remoteDeviceCode);
    manager.open = true;
    window.TinyFrensWalletConnected = addresses.length > 0;
    document.getElementById('accountHeading').textContent = addresses.length ? 'Your account' : 'Set up your account';
    document.getElementById('accountIntro').textContent = addresses.length ? 'Wallets, linked devices and profile.' : 'Connect a wallet or link a device you already use.';
    if ((!addresses.length || approvingDevice) && window.showScreen && document.getElementById('screen-pet').hidden === false) window.showScreen('account');
    manager.querySelector('summary').textContent = addresses.length ? `Connected wallets (${addresses.length})` : 'Add wallets';
    document.getElementById('supportedNFTPanel').hidden = !addresses.length;
    linkedWallet.replaceChildren();
    if (!addresses.length) linkedWallet.textContent = 'No wallets linked yet.';
    for (const address of addresses) {
      const row = document.createElement('div'); row.className = 'linked-wallet-row';
      const label = document.createElement('span'); label.textContent = address;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary';
      remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove wallet ' + address);
      remove.onclick = async () => {
        remove.disabled = true;
        try {
          const data = await post('/api/wallet-link/disconnect', {address});
          await window.removeImportedWallet(address);
          showLink(data.addresses || []);
          linkStatus.textContent = 'Wallet removed. Your other wallet links stay connected.';
          await scan();
          if (manager.open) await startPairing();
        } catch (error) { linkStatus.textContent = error.message; remove.disabled = false; }
      };
      row.append(label, remove); linkedWallet.append(row);
    }
    linkButton.textContent = addresses.length ? 'Add wallet manually' : 'Connect wallet manually';
    scanButton.disabled = !addresses.length;
    if (!addresses.length) matches.replaceChildren();
  }

  if (window.PetAndroid) setInterval(() => {
    if (document.hidden) return;
    try {
      const visible = PetAndroid.isPetVisible() ? JSON.parse(PetAndroid.getTurtle()).items || [] : [];
      const shown = new Set(visible.map(window.TinyFrensCompanionKey));
      for (const button of document.querySelectorAll('[data-native-companion]')) if (!button.disabled) button.checked = shown.has(button.dataset.nativeCompanion);
    } catch {}
  }, 1000);

  document.getElementById('nftSearch').oninput = event => {
    const query = event.target.value.trim().toLowerCase();
    for (const card of matches.children) card.hidden = !card.dataset.search.includes(query);
  };
  const verifiedArt = new Map();
  function verify(nft) {
    const id = window.TinyFrensCompanionKey(nft);
    if (!verifiedArt.has(id)) verifiedArt.set(id, post('/api/featured/companion', {tokenId:nft.tokenId, originalAddress:nft.originalAddress, chainId:nft.chainId}).catch(error => { verifiedArt.delete(id); throw error; }));
    return verifiedArt.get(id).then(data => {
      if (Date.now() >= data.validUntil * 1000) { verifiedArt.delete(id); return verify(nft); }
      return data;
    });
  }
  async function scan() {
    if (!linkedAddresses.length) return;
    scanButton.disabled = true;
    scanStatus.textContent = 'Finding NFTs from available collections…';
    try {
      const result = await post('/api/wallet-link/nfts');
      const data = {...result, errors:result.errors || [], nfts:result.nfts.map(nft => ({...nft,
        contract:nft.originalAddress, chain:nft.chainId === 8453 ? 'Base' : 'Robinhood Chain', standard:'ERC-721', companionSupported:true}))};
      matches.replaceChildren();
      const supported = data.nfts.filter(window.TinyFrensNFTDiscovery.isSupported);
      document.querySelector('.nft-search').hidden = supported.length === 0;
      const previews = [];
      for (const nft of supported) {
        const card = document.createElement('article');
        card.className = 'wallet-nft';
        card.dataset.search = `${nft.name} ${nft.collection} ${nft.tokenId}`.toLowerCase();
        const art = document.createElement('img');
        art.alt = nft.name; art.className = 'wallet-nft-art'; art.loading = 'lazy'; art.referrerPolicy = 'no-referrer';
        const previewStatus = document.createElement('span'); previewStatus.className = 'nft-preview-status'; previewStatus.textContent = 'Loading artwork…';
        art.hidden = true; card.append(art, previewStatus);
        const showArt = image => { if (image) { art.src = image; art.hidden = false; previewStatus.hidden = true; } };
        art.onerror = () => { art.hidden = true; previewStatus.hidden = false; previewStatus.textContent = 'Preview unavailable'; };
        if (nft.image) showArt(nft.image);
        else previews.push(async () => { try { const data = await verify(nft); showArt(data.image); if (!data.image) previewStatus.textContent = 'Preview unavailable'; } catch { previewStatus.textContent = 'Preview unavailable'; } });
        const info = document.createElement('div'); info.className = 'nft-row-info';
        const title = document.createElement('strong');
        title.textContent = nft.name;
        const detail = document.createElement('p');
        detail.textContent = nft.chain + ' · ' + nft.wallet.slice(0,6) + '…' + nft.wallet.slice(-4);
        info.append(title,detail); card.append(info);
        if (nft.companionSupported) {
          const link = document.createElement('input');
          link.type = 'checkbox'; link.dataset.companion = window.TinyFrensCompanionKey(nft); link.setAttribute('aria-label', 'Show ' + nft.name + ' on screen');
          if (window.PetAndroid) link.dataset.nativeCompanion = window.TinyFrensCompanionKey(nft);
          const androidShowing = () => { try { return window.PetAndroid?.isPetVisible() && JSON.parse(PetAndroid.getTurtle()).items?.some(item => window.TinyFrensCompanionKey(item) === window.TinyFrensCompanionKey(nft)); } catch { return false; } };
          const isShowing = () => window.PetAndroid ? androidShowing() : window.TinyFrensDesktop?.getTurtle ? JSON.parse(TinyFrensDesktop.getTurtle()).items?.some(item => window.TinyFrensCompanionKey(item) === window.TinyFrensCompanionKey(nft)) : JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]').some(item => window.TinyFrensCompanionKey(item) === window.TinyFrensCompanionKey(nft));
          link.checked = isShowing();
          link.onchange = async () => {
            link.disabled = true;
            try {
              if (!link.checked) {
                if (window.PetAndroid?.hideCompanion) PetAndroid.hideCompanion(window.TinyFrensCompanionKey(nft));
                else {
                  if (window.TinyFrensDesktop?.turtleRequest) await post('/native/remove-turtle', {tokenId:nft.tokenId, originalAddress:nft.originalAddress, chainId:nft.chainId});
                  localStorage.setItem('tinyfrens-companions', JSON.stringify(JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]').filter(item => window.TinyFrensCompanionKey(item) !== window.TinyFrensCompanionKey(nft))));
                }
                window.dispatchEvent(new Event('tinyfrens-wallet-link-changed')); return;
              }
              const verified = await verify(nft);
              if (!verified.active) throw new Error('None of your linked wallets currently owns this NFT. Check the wallet address shown on its card.');
              if (!verified.companion) throw new Error('Ownership verified, but this NFT’s artwork could not be prepared for animation.');
              if (Date.now() >= verified.validUntil * 1000) throw new Error('Your ownership check expired. Refresh NFTs and try again.');
              const saved = JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]').filter(item => window.TinyFrensCompanionKey(item) !== window.TinyFrensCompanionKey(verified));
              if (!window.PetAndroid && saved.length >= 5) throw new Error('You can show up to five companions. Remove one first.');
              if (window.PetAndroid?.turtleRequest || window.TinyFrensDesktop?.turtleRequest) await post('/native/import-turtle', {tokenId:verified.tokenId, originalAddress:verified.originalAddress, chainId:verified.chainId});
              saved.push(verified);
              await window.TinyFrensSetCompanionSize?.(verified, Number(size.value));
              localStorage.setItem('tinyfrens-companions', JSON.stringify(saved));
              window.dispatchEvent(new Event('tinyfrens-wallet-link-changed'));
              if (window.PetAndroid) {
                const started = PetAndroid.startPet();
                link.checked = started;
                scanStatus.textContent = started ? 'Showing on your screen.' : 'Allow TinyFrens to display over other apps, then tap Show on screen again.';
              } else { if (window.TinyFrensDesktop && !TinyFrensDesktop.isPetVisible()) TinyFrensDesktop.togglePet(); window.showScreen('pet'); document.getElementById('stage').scrollIntoView({block:'center'}); link.checked = true; }
            } catch (error) { scanStatus.textContent = error.message; }
            finally { link.disabled = false; link.checked = isShowing(); }
          };
          const toggle = document.createElement('label'); toggle.className = 'nft-show-toggle'; toggle.append(link, document.createTextNode('Show'));
          const sizeLabel = document.createElement('label'); sizeLabel.className = 'nft-size'; sizeLabel.textContent = 'Size';
          const size = document.createElement('input'); size.type = 'range'; size.dataset.companionSize = window.TinyFrensCompanionKey(nft); size.min = '48'; size.max = '128'; size.step = '1'; size.setAttribute('aria-label', nft.name + ' size');
          size.value = window.TinyFrensCompanionSize?.(nft) || 80;
          const sizeValue = document.createElement('output'); sizeValue.value = size.value;
          let sizeTimer;
          const saveSize = async () => { try { await window.TinyFrensSetCompanionSize(nft, Number(size.value), isShowing()); } catch (error) { scanStatus.textContent = error.message; } };
          size.oninput = () => { sizeValue.value = size.value; clearTimeout(sizeTimer); sizeTimer = setTimeout(saveSize, 100); };
          size.onchange = () => { clearTimeout(sizeTimer); saveSize(); };
          sizeLabel.append(size, sizeValue); info.append(sizeLabel); card.append(toggle);
        }
        matches.append(card);
      }
      document.getElementById('nftSearch').dispatchEvent(new Event('input'));
      // Two artwork requests at a time; ownership/artwork are cached by the relay.
      const queue = [...previews];
      const worker = async () => { while (queue.length) await queue.shift()(); };
      void Promise.all([worker(), worker()]);
      const failed = data.errors.length;
      scanStatus.textContent = (supported.length ? supported.length + ' supported NFT(s) found.' : 'No supported NFTs found yet. Check your wallets in Account, or refresh after your next mint.') +
        (data.partial ? ' Partial scan: ' + failed + ' indexer request(s) failed or pages were limited.' : '') +
        (failed ? ' ' + data.errors.slice(0,2).join('; ') : '');
    } catch(error) {
      scanStatus.textContent = error.message;
    } finally {
      scanButton.disabled = !linkedAddresses.length;
    }
  }

  async function loadLink() {
    const data = await post('/api/wallet-link/status');
    showLink(data.addresses || (data.address ? [data.address] : []));
    linkStatus.textContent = linkedAddresses.length ? 'Linked wallets are checked together. Add another whenever you need.' : '';
    if (linkedAddresses.length) await scan();
  }

  linkButton.addEventListener('click', async () => {
    linkButton.disabled = true;
    try {
      if (!window.ethereum?.request) {
        document.getElementById('connectInBrowser').hidden = !installedApp;
        throw new Error(installedApp
          ? 'Use “Sign in browser” to sign with your wallet, then return to this app and approve the connection.'
          : 'No browser wallet detected. Open this same page in a browser with your wallet extension, or connect with Bankr.');
      }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0];
      if (!address) throw new Error('No wallet selected.');
      const remoteCode = remoteDeviceCode;
      const challenge = remoteCode
        ? await window.TinyFrensTurtleAPI(base(), '/api/turtle-connect/challenge', {code:remoteCode, address})
        : await post('/api/wallet-link/challenge', { address });
      linkStatus.textContent = 'Review the read-only message in your wallet and sign it.';
      const signature = await window.ethereum.request({
        method: 'personal_sign', params: [challenge.message, address],
      });
      if (remoteCode) {
        await window.TinyFrensTurtleAPI(base(), '/api/turtle-connect/confirm', {code:remoteCode, challengeId:challenge.challengeId, signature});
        linkStatus.textContent = 'Wallet verified. Return to your other device and accept the wallet link.';
        return;
      }
      const result = await post('/api/wallet-link/confirm', { signature });
      showLink(result.addresses || [result.address]);
      linkStatus.textContent = 'Wallet linked. You will not need to sign again for read-only NFT checks.';
      await scan();
      if (manager.open) await startPairing();
    } catch (error) {
      linkStatus.textContent = error.message || 'Wallet link was not completed.';
    } finally {
      linkButton.disabled = false;
    }
  });

  scanButton.addEventListener('click', scan);
  const prompt = document.getElementById('bankrWalletPrompt');
  const copy = prompt;
  const renew = document.getElementById('renewWalletPairing');
  const accept = document.getElementById('acceptWalletPairing');
  const pairingStatus = document.getElementById('walletPairingStatus');
  let pairing, timer, polling = false;
  async function pollPairing() {
    clearTimeout(timer);
    if (!pairing || document.hidden || polling) return;
    if (Date.now() >= pairing.expires * 1000) {
      pairing = null; copy.disabled = true; accept.hidden = true;
      pairingStatus.textContent = 'This connection code timed out. Get a new connection code to continue.'; return;
    }
    const current = pairing; polling = true;
    try {
      const data = await post('/api/turtle-connect/status', {code:current.code});
      if (pairing !== current) return;
      accept.hidden = !data.verified;
      pairingStatus.textContent = data.verified ? `Ready to link ${data.wallet}. Accept only if this is your wallet.` : 'Waiting for a wallet signature, Bankr, or approval from your connected device…';
    } catch (error) { if (pairing === current) { accept.hidden = true; pairingStatus.textContent = error.message; } }
    finally { polling = false; if (pairing && !document.hidden) timer = setTimeout(pollPairing, 4000); }
  }
  async function startPairing() {
    renew.disabled = true; copy.disabled = true; accept.hidden = true;
    pairing = null; clearTimeout(timer); prompt.textContent = '';
    try {
      pairing = await post('/api/turtle-connect/start');
      const code = pairing.code.match(/.{1,4}/g).join('-');
      document.getElementById('deviceConnectCode').textContent = `Bankr connection code: ${code}.`;
      const browserLink = document.getElementById('connectInBrowser');
      browserLink.href = 'https://www.tinyfrens.lol/web/#connect-device=' + encodeURIComponent(pairing.code);
      browserLink.hidden = !installedApp || Boolean(window.ethereum?.request);
      prompt.textContent = `Hey @bankrbot use the skill at https://tinyfrens.lol/import/skill.md to link my wallet to TinyFrens and find my supported NFTs. My connect code is ${code}. Keep my NFTs in my wallet.`;
      copy.disabled = false; await pollPairing();
    } catch (error) { prompt.textContent = 'Connection unavailable. Retry when your device is online.'; pairingStatus.textContent = error.message; }
    finally { renew.disabled = false; }
  }
  copy.onclick = async () => {
    if (!pairing || Date.now() >= pairing.expires * 1000) { await pollPairing(); return; }
    try { await navigator.clipboard.writeText(prompt.textContent); pairingStatus.textContent = 'Copied. Paste into X or Bankr chat.'; prompt.classList.add('copied'); setTimeout(() => prompt.classList.remove('copied'), 1800); }
    catch { const range = document.createRange(); range.selectNodeContents(prompt); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); pairingStatus.textContent = 'Select and copy the message above.'; }
  };
  prompt.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); copy.onclick(); } };
  renew.onclick = startPairing;
  manager.addEventListener('toggle', () => { if (manager.open && !pairing && !renew.disabled) { try { identity(); startPairing(); } catch {} } });
  accept.onclick = async () => {
    if (!pairing) return;
    accept.disabled = true;
    try {
      const current = pairing;
      await post('/api/turtle-connect/accept', {code:current.code});
      pairing = null; clearTimeout(timer); accept.hidden = true; copy.disabled = true; prompt.textContent = '';
      prompt.textContent = 'Choose New code to connect another wallet.';
      pairingStatus.textContent = 'Wallet connected. Choose an NFT below, or create a new code to add another wallet.';
      await loadLink();
    } catch (error) { prompt.textContent = 'Connection unavailable. Retry when your device is online.'; pairingStatus.textContent = error.message; }
    finally { accept.disabled = false; }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollPairing(); });
  let loading = false;
  showLink([]);
  async function initialLoad() {
    if (loading) return;
    loading = true;
    try { await loadLink(); if (manager.open && !pairing && !renew.disabled) await startPairing(); }
    catch (error) {
      linkStatus.textContent = 'Could not connect to your account. Check your connection and retry.';
      prompt.textContent = 'Waiting for account connection.';
    } finally { loading = false; }
  }
  window.addEventListener('tinyfrens-identity-ready', initialLoad);
  window.addEventListener('online', initialLoad);
  window.addEventListener('tinyfrens-account-synced', initialLoad);
  window.addEventListener('tinyfrens-wallet-link-changed', () => {
    try {
      const bridge = window.PetAndroid || window.TinyFrensDesktop;
      const items = bridge?.getTurtle ? JSON.parse(bridge.getTurtle()).items || [] : JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]');
      const shown = new Set(items.map(window.TinyFrensCompanionKey));
      const motions = JSON.parse(localStorage.getItem('tinyfrens-companion-motion') || '{}');
      for (const input of matches.querySelectorAll('[data-companion]')) input.checked = shown.has(input.dataset.companion);
      for (const input of matches.querySelectorAll('[data-companion-size]')) {
        if (document.activeElement === input) continue;
        input.value = motions[input.dataset.companionSize]?.size || items.find(n => window.TinyFrensCompanionKey(n) === input.dataset.companionSize)?.motion?.size || input.value;
        input.nextElementSibling.value = input.value;
      }
    } catch {}
  });
  initialLoad();
})();
