(() => {
  const target = document.getElementById('externalWalletPanel');
  if (!target) return;
  target.innerHTML = `
    <section class="overlay wallet-link-panel" style="margin-top:0;">
      <h3>Connect your wallet</h3>
      <p class="small">Sign one plain-text message to link an external Web3 address to this fren. No gas, approvals, transfers, seed phrases, or spending permissions. Your external NFTs stay in your wallet.</p>
      <p id="linkedWallet" class="wallet-link-address" style="font-family:monospace;word-break:break-all;color:inherit;"></p>
      <div class="actions">
        <button type="button" id="linkWallet">Link external wallet</button>
        <button type="button" id="unlinkWallet" class="secondary" hidden>Disconnect</button>
      </div>
      <p id="walletLinkStatus" role="status"></p>
    </section>
    <section class="overlay wallet-link-panel">
      <h3>Your supported NFTs</h3>
      <p class="small">Hood Turtles are available now. This wallet link also covers collections we support later. Choose multiple companions from your wallet.</p>
      <button type="button" id="scanWallet" class="secondary" disabled>Refresh external NFTs</button>
      <div id="walletMatches" class="wallet-nfts" aria-live="polite"></div>
      <p id="walletScanStatus" role="status"></p>
    </section>
    <p class="small">The link stays with this fren until you disconnect it.</p>
  `;

  const linkedWallet = document.getElementById('linkedWallet');
  const linkButton = document.getElementById('linkWallet');
  const unlinkButton = document.getElementById('unlinkWallet');
  const scanButton = document.getElementById('scanWallet');
  const linkStatus = document.getElementById('walletLinkStatus');
  const scanStatus = document.getElementById('walletScanStatus');
  const matches = document.getElementById('walletMatches');
  const base = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  let linkedAddress = null;

  function identity() {
    const current = window.TinyFrensFriends?.identity?.() || JSON.parse(localStorage.getItem('tinyfrens-device:' + base()) || 'null');
    if (!current?.token) throw new Error('Your fren is still connecting. Try again in a moment.');
    return current;
  }

  async function post(path, values = {}) {
    return window.TinyFrensTurtleAPI(base(), path, {token:identity().token, ...values});
  }

  function showLink(address) {
    linkedAddress = address;
    linkedWallet.textContent = address ? `Linked: ${address}` : 'No wallet linked yet.';
    linkButton.textContent = address ? 'Change wallet' : 'Link my wallet';
    unlinkButton.hidden = !address;
    scanButton.disabled = !address;
    if (!address) matches.replaceChildren();
  }

  async function scan() {
    if (!linkedAddress) return;
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
        detail.textContent = 'Hood Turtles · Robinhood Chain · Currently owned';
        const link = document.createElement('a');
        link.href = `hood-turtles.html?tokenId=${nft.tokenId}`;
        link.textContent = 'Import my turtle →';
        card.append(title, detail, link);
        matches.append(card);
      }
      scanStatus.textContent = data.nfts.length
        ? `${data.nfts.length} supported NFT${data.nfts.length === 1 ? '' : 's'} found.${data.partial ? ' More may exist; scan is limited to the first five indexer pages.' : ''}`
        : `No supported NFTs found in this wallet.${data.partial ? ' Scan was partial; some NFTs may not be listed.' : ''}`;
    } catch (error) {
      scanStatus.textContent = error.message;
    } finally {
      scanButton.disabled = !linkedAddress;
    }
  }

  async function loadLink() {
    const data = await post('/api/wallet-link/status');
    showLink(data.address);
    linkStatus.textContent = data.address ? 'Connected for read-only discovery. No wallet app needed to check again.' : '';
    if (data.address) await scan();
  }

  linkButton.addEventListener('click', async () => {
    linkButton.disabled = true;
    try {
      if (!window.ethereum?.request) { location.href = 'hood-turtles.html'; return; }
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0];
      if (!address) throw new Error('No wallet selected.');
      const challenge = await post('/api/wallet-link/challenge', { address });
      linkStatus.textContent = 'Review the read-only message in your wallet and sign it.';
      const signature = await window.ethereum.request({
        method: 'personal_sign', params: [challenge.message, address],
      });
      const result = await post('/api/wallet-link/confirm', { signature });
      window.clearImportedTurtle?.();
      showLink(result.address);
      linkStatus.textContent = 'Wallet linked. You will not need to sign again for read-only NFT checks.';
      await scan();
    } catch (error) {
      linkStatus.textContent = error.message || 'Wallet link was not completed.';
    } finally {
      linkButton.disabled = false;
    }
  });

  unlinkButton.addEventListener('click', async () => {
    unlinkButton.disabled = true;
    try {
      await post('/api/wallet-link/disconnect');
      showLink(null);
      scanStatus.textContent = '';
      linkStatus.textContent = 'Wallet disconnected from this fren.';
      localStorage.removeItem('tinyfrens-hood-turtle');
      window.clearImportedTurtle?.();
      window.dispatchEvent(new Event('tinyfrens-wallet-link-changed'));
    } catch (error) {
      linkStatus.textContent = error.message;
    } finally {
      unlinkButton.disabled = !linkedAddress;
    }
  });

  scanButton.addEventListener('click', scan);
  let attempts = 0;
  showLink(null);
  async function initialLoad() {
    try { await loadLink(); }
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
