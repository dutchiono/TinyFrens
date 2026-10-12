(() => {
  const target = document.getElementById('externalWalletPanel');
  if (!target) return;
  target.innerHTML = `
    <details id="walletManager" class="wallet-manager" open><summary>Connect your wallet</summary>
    <section class="overlay wallet-link-panel" style="margin-top:0;">
      <h3>Connect your wallet</h3>
      <p class="small">Use your wallet directly, or copy the message below and send it to Bankr. Your NFTs stay in your wallet.</p>
      <div id="linkedWallet" class="wallet-link-address"></div>
      <div class="actions">
        <button type="button" id="linkWallet">Connect wallet manually</button>

      </div>
      <p id="walletLinkStatus" role="status"></p>
      <div class="bankr-connect">
        <h4>Connect with Bankr</h4>
        <p class="small">Send this to @bankrbot on X or in Bankr chat, then accept the wallet link here.</p>
        <label for="bankrWalletPrompt">Your Bankr message</label>
        <textarea id="bankrWalletPrompt" readonly rows="5" placeholder="Preparing your device code…"></textarea>
        <div class="actions"><button type="button" id="copyBankrWalletPrompt" disabled>Copy Bankr message</button><button type="button" id="renewWalletPairing" class="secondary">New code</button><button type="button" id="acceptWalletPairing" hidden>Accept wallet link</button></div>
        <p id="walletPairingStatus" role="status"></p>
      </div>
    </section></details>
    <section id="supportedNFTPanel" class="overlay wallet-link-panel" hidden>
      <h3>Your supported NFTs</h3>
      <p class="small">Hood Turtles are available now. This wallet link also covers collections we support later. Choose multiple companions from your wallet.</p>
      <button type="button" id="scanWallet" class="secondary" disabled>Refresh external NFTs</button>
      <div id="walletMatches" class="wallet-nfts" aria-live="polite"></div>
      <p id="walletScanStatus" role="status"></p>
    </section>
    <p class="small">Each wallet stays linked to this device until you remove it.</p>
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
    manager.open = !addresses.length;
    manager.querySelector('summary').textContent = addresses.length ? `Manage wallets (${addresses.length}) · Add another` : 'Connect your wallet';
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

  async function scan() {
    if (!linkedAddresses.length) return;
    scanButton.disabled = true;
    scanStatus.textContent = 'Checking supported NFTs…';
    try {
      const data = await post('/api/wallet-link/nfts');
      matches.replaceChildren();
      for (const nft of data.nfts) {
        const card = document.createElement('article');
        card.className = 'wallet-nft';
        const title = document.createElement('strong');
        title.textContent = nft.name;
        const detail = document.createElement('p');
        detail.textContent = `${nft.collection} · ${nft.wallet.slice(0,6)}…${nft.wallet.slice(-4)}`;
        const link = document.createElement('button');
        link.type = 'button'; link.textContent = 'Show NFT';
        link.onclick = async () => {
          link.disabled = true;
          try {
            const verified = await post('/api/featured/hood-turtle', {tokenId:nft.tokenId});
            if (!verified.active || !verified.companion || Date.now() >= verified.validUntil * 1000) throw new Error('This NFT is not ready to show. Refresh your collection and try again.');
            const saved = JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]').filter(item => item.tokenId !== verified.tokenId);
            if (saved.length >= 5) throw new Error('You can show up to five companions. Remove one first.');
            if (window.PetAndroid?.turtleRequest || window.TinyFrensDesktop?.turtleRequest) await post('/native/import-turtle', {tokenId:verified.tokenId});
            saved.push(verified); localStorage.setItem('tinyfrens-companions', JSON.stringify(saved));
            window.dispatchEvent(new Event('tinyfrens-wallet-link-changed'));
            window.showScreen('pet'); document.getElementById('stage').scrollIntoView({block:'center'});
            link.textContent = 'Showing';
          } catch (error) { scanStatus.textContent = error.message; }
          finally { link.disabled = false; }
        };
        card.append(title, detail, link);
        matches.append(card);
        // Original art appears as it loads; loading a preview never imports it.
        post('/api/featured/hood-turtle', {tokenId:nft.tokenId}).then(verified => {
          const source = verified.companion?.idle || verified.image;
          if (!verified.active || !/^data:image\/(svg\+xml|png);base64,/.test(source || '') || !card.isConnected) return;
          const art = document.createElement('img'); art.src = source; art.alt = nft.name; art.className = 'wallet-nft-art';
          card.prepend(art);
        }).catch(() => {});
      }
      scanStatus.textContent = data.nfts.length
        ? `${data.nfts.length} supported NFT${data.nfts.length === 1 ? '' : 's'} found.${data.partial ? ' More may exist; scan is limited to the first five indexer pages.' : ''}`
        : `No supported NFTs found in this wallet.${data.partial ? ' Scan was partial; some NFTs may not be listed.' : ''}`;
    } catch (error) {
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
      if (!window.ethereum?.request) throw new Error('Use a browser with your wallet extension for manual connection, or copy the Bankr message below.');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0];
      if (!address) throw new Error('No wallet selected.');
      const challenge = await post('/api/wallet-link/challenge', { address });
      linkStatus.textContent = 'Review the read-only message in your wallet and sign it.';
      const signature = await window.ethereum.request({
        method: 'personal_sign', params: [challenge.message, address],
      });
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
  const copy = document.getElementById('copyBankrWalletPrompt');
  const renew = document.getElementById('renewWalletPairing');
  const accept = document.getElementById('acceptWalletPairing');
  const pairingStatus = document.getElementById('walletPairingStatus');
  let pairing, timer, polling = false;
  async function pollPairing() {
    clearTimeout(timer);
    if (!pairing || document.hidden || polling) return;
    if (Date.now() >= pairing.expires * 1000) {
      pairing = null; copy.disabled = true; accept.hidden = true;
      pairingStatus.textContent = 'Code expired. Choose New code to continue.'; return;
    }
    const current = pairing; polling = true;
    try {
      const data = await post('/api/turtle-connect/status', {code:current.code});
      if (pairing !== current) return;
      accept.hidden = !data.verified;
      pairingStatus.textContent = data.verified ? `Bankr verified ${data.wallet}. Accept only if this is your wallet.` : 'Waiting for Bankr…';
    } catch (error) { if (pairing === current) { accept.hidden = true; pairingStatus.textContent = error.message; } }
    finally { polling = false; if (pairing && !document.hidden) timer = setTimeout(pollPairing, 4000); }
  }
  async function startPairing() {
    renew.disabled = true; copy.disabled = true; accept.hidden = true;
    pairing = null; clearTimeout(timer); prompt.value = '';
    try {
      pairing = await post('/api/turtle-connect/start');
      const code = pairing.code.match(/.{1,4}/g).join('-');
      prompt.value = `Hey @bankrbot use the skill at https://tinyfrens.lol/import/skill.md to link my wallet to TinyFrens and find my supported NFTs. My connect code is ${code}. Keep my NFTs in my wallet.`;
      copy.disabled = false; await pollPairing();
    } catch (error) { pairingStatus.textContent = error.message; }
    finally { renew.disabled = false; }
  }
  copy.onclick = async () => {
    if (!pairing || Date.now() >= pairing.expires * 1000) { await pollPairing(); return; }
    try { await navigator.clipboard.writeText(prompt.value); pairingStatus.textContent = 'Copied. Paste into X or Bankr chat.'; }
    catch { prompt.focus(); prompt.select(); pairingStatus.textContent = 'Select and copy the message above.'; }
  };
  renew.onclick = startPairing;
  manager.addEventListener('toggle', () => { if (manager.open && !pairing && !renew.disabled) { try { identity(); startPairing(); } catch {} } });
  accept.onclick = async () => {
    if (!pairing) return;
    accept.disabled = true;
    try {
      const current = pairing;
      await post('/api/turtle-connect/accept', {code:current.code});
      pairing = null; clearTimeout(timer); accept.hidden = true; copy.disabled = true; prompt.value = '';
      prompt.placeholder = 'Choose New code to connect another wallet.';
      pairingStatus.textContent = 'Wallet connected. Choose an NFT below, or create a new code to add another wallet.';
      await loadLink();
    } catch (error) { pairingStatus.textContent = error.message; }
    finally { accept.disabled = false; }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollPairing(); });
  let attempts = 0;
  showLink([]);
  async function initialLoad() {
    try { await loadLink(); if (manager.open && !pairing && !renew.disabled) await startPairing(); }
    catch (error) {
      if (++attempts < 8 && !window.TinyFrensFriends?.identity?.()?.token) {
        setTimeout(initialLoad, 1000);
      } else {
        linkStatus.textContent = error.message;
      }
    }
  }
  initialLoad();
})();
