'use strict';
(() => {
  const form = $('walletForm'), question = $('walletQuestion'), ask = $('walletAsk'), status = $('walletStatus'), reply = $('walletReply');
  const refresh = $('walletRefreshNfts'), nftList = $('walletNfts');
  const vaultAddressInput = $('vaultAddressInput'), copyVaultAddress = $('copyVaultAddress'), vaultStatusChip = $('vaultStatusChip');
  const mintNftButton = $('mintNftButton'), mintSubtext = $('mintSubtext');
  const tokenIdInput = $('walletTokenId'), renameInput = $('walletRenameInput'), renameNftButton = $('walletRenameNft'), evolveNftButton = $('walletEvolveNft');
  const magicLinkButton = $('magicLinkButton'), magicLinkBox = $('magicLinkBox'), magicLinkInput = $('magicLinkInput'), copyMagicLink = $('copyMagicLink');

  const server = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  let wallet = null;
  let livePriceQuote = null;

  function petProfile() {
    const s = read();
    return {
      name: cleanName(s.name) || 'Your fren',
      shape: s.shape === 'mascot' ? 'robot' : ['cat','blob','robot','bunny','dog','bear','frog','turtle'].includes(s.shape) ? s.shape : 'cat',
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#a474f1',
      expression: s.expression || 'happy',
      accessory: s.accessory || 'none',
      tokenId: s.tokenId || null
    };
  }

  function identity() {
    const id = window.TinyFrensFriends?.identity?.();
    if (id?.token) return id;
    window.TinyFrensFriends?.connect?.();
    return null;
  }

  function walletAddress() {
    return wallet?.evmAddress || wallet?.solAddress || '';
  }

  function currentTokenId() {
    const raw = Number(tokenIdInput?.value || read().tokenId || 0);
    return Number.isInteger(raw) && raw > 0 ? raw : 0;
  }

  function syncOnchainControls() {
    const s = read();
    if (tokenIdInput && !tokenIdInput.value && s.tokenId) tokenIdInput.value = String(s.tokenId);
    if (renameInput && !renameInput.value) renameInput.value = cleanName(s.name) || '';
  }

  function showWallet(data) {
    wallet = data;
    if (vaultAddressInput && data.evmAddress) {
      vaultAddressInput.value = data.evmAddress;
    }
    if (vaultStatusChip) {
      vaultStatusChip.textContent = data.partner ? 'Bankr Partner' : 'Base Vault';
    }
  }

  async function post(path, body) {
    const base = server(), id = identity();
    if (!base) throw new Error('Connect the TinyFrens server first.');
    if (!id) throw new Error('Connecting your fren identity. Try again in a moment.');
    const response = await fetch(base + path, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({token: id.token, ...body})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Server error.');
    return data;
  }

  async function fetchPriceQuote() {
    try {
      const base = server();
      if (!base) return;
      const res = await fetch(base + '/api/nft/price');
      if (!res.ok) return;
      livePriceQuote = await res.json();
      if (mintNftButton && livePriceQuote.ethRequired) {
        const ethFmt = Number(livePriceQuote.ethRequired).toLocaleString(undefined, {maximumFractionDigits: 6});
        mintNftButton.textContent = `✨ Mint TinyFren · ${ethFmt} ETH`;
      }
      if (mintSubtext && livePriceQuote.ethRequired) {
        const ethFmt = Number(livePriceQuote.ethRequired).toLocaleString(undefined, {maximumFractionDigits: 6});
        mintSubtext.textContent = `Official on-chain mint paid in ETH on Base (${ethFmt} ETH).`;
      }
    } catch (_) {}
  }

  async function loadWallet() {
    if (status) status.textContent = 'Loading fren pocket vault...';
    try {
      showWallet(await post('/api/bankr/wallet', {pet: petProfile()}));
      if (status) status.textContent = 'Fren Pocket Vault connected on Base.';
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not load fren vault.';
    }
    fetchPriceQuote();
  }

  function nftTitle(nft) {
    const collection = nft.collection?.name || nft.collectionName || 'NFT';
    return (nft.name || collection + ' #' + (nft.tokenId || '?')).slice(0, 80);
  }

  function savePetLook(pet) {
    let state;
    if (desktop) state = JSON.parse(desktop.customize(JSON.stringify(pet)));
    else if (native) state = JSON.parse(PetAndroid.customize(JSON.stringify(pet)));
    else { state = Object.assign(read(), pet); localStorage.setItem(key, JSON.stringify(state)); }
    window.stylePet?.(state);
    render(state);
    window.dispatchEvent(new Event('pet-profile-changed'));
    window.animatePet?.('dance');
  }

  function drawNfts(nfts) {
    if (!nftList) return;
    nftList.replaceChildren();
    if (!nfts.length) {
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = 'No NFTs found yet. Send one to your Fren Vault address or mint above!';
      nftList.append(p);
      return;
    }
    for (const nft of nfts.slice(0, 24)) {
      const card = document.createElement('article');
      card.className = 'wallet-nft';
      const title = document.createElement('strong');
      title.textContent = nftTitle(nft);
      const meta = document.createElement('p');
      meta.textContent = [nft.chain, nft.collection?.name, nft.tokenId ? '#' + nft.tokenId : ''].filter(Boolean).join(' · ');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Wear this look';
      button.onclick = async () => {
        if (status) status.textContent = 'Equipping NFT look on your fren...';
        try {
          const data = await post('/api/bankr/transform', {nft});
          savePetLook(data.pet);
          if (status) status.textContent = 'Your fren equipped ' + nftTitle(nft) + '!';
        } catch (error) {
          if (status) status.textContent = error.message || 'Could not transform your fren.';
        }
      };
      card.append(title, meta, button);
      nftList.append(card);
    }
  }

  async function loadNfts() {
    if (status) status.textContent = 'Checking fren vault for NFTs...';
    try {
      if (!wallet) await loadWallet();
      const data = await post('/api/bankr/nfts', {});
      drawNfts(data.nfts || []);
      if (status) status.textContent = (data.nfts || []).length ? 'Pick an NFT for your fren to wear.' : 'No NFTs found in vault yet.';
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not refresh NFTs.';
    }
  }

  if (copyVaultAddress && vaultAddressInput) {
    copyVaultAddress.onclick = async () => {
      const addr = vaultAddressInput.value;
      if (!addr || addr.startsWith('Loading')) return;
      try {
        await navigator.clipboard.writeText(addr);
        copyVaultAddress.textContent = '✅ Copied!';
        setTimeout(() => { copyVaultAddress.textContent = '📋 Copy'; }, 2000);
      } catch (_) {
        vaultAddressInput.select();
      }
    };
  }

  if (mintNftButton) {
    mintNftButton.onclick = async () => {
      mintNftButton.disabled = true;
      if (status) status.textContent = 'Minting your TinyFren NFT in ETH on Base...';
      try {
        const data = await post('/api/wallet/mint', {});
        if (data.success && data.nft) {
          savePetLook(data.pet);
          if (tokenIdInput) tokenIdInput.value = String(data.nft.tokenId || '');
          if (renameInput) renameInput.value = cleanName(data.pet.name) || '';
          if (status) status.textContent = `🎉 Minted TinyFren #${data.nft.tokenId}! Your fren is wearing their 1:1 on-chain look.`;
          await loadNfts();
          window.animatePet?.('dance');
        }
      } catch (err) {
        if (status) status.textContent = err.message || 'Minting error. Check ETH balance.';
      } finally {
        mintNftButton.disabled = false;
      }
    };
  }

  if (renameNftButton) {
    renameNftButton.onclick = async () => {
      const tokenId = currentTokenId();
      const name = renameInput?.value?.trim();
      if (!tokenId) { if (status) status.textContent = 'Pick the TinyFren token to rename first.'; return; }
      if (!name) { if (status) status.textContent = 'Type the new on-chain name first.'; return; }
      renameNftButton.disabled = true;
      if (status) status.textContent = `Signing rename for TinyFren #${tokenId}...`;
      try {
        const data = await post('/api/wallet/rename-nft', {tokenId, name});
        if (data.pet) savePetLook(data.pet);
        if (status) status.textContent = `Rename sent. Tx: ${data.tx?.hash || 'submitted'}`;
        window.animatePet?.('wave');
      } catch (err) {
        if (status) status.textContent = err.message || 'Could not rename NFT.';
      } finally {
        renameNftButton.disabled = false;
      }
    };
  }

  if (evolveNftButton) {
    evolveNftButton.onclick = async () => {
      const tokenId = currentTokenId();
      if (!tokenId) { if (status) status.textContent = 'Pick the TinyFren token to evolve first.'; return; }
      evolveNftButton.disabled = true;
      if (status) status.textContent = `Signing evolution for TinyFren #${tokenId}...`;
      try {
        const data = await post('/api/wallet/evolve-nft', {tokenId});
        if (status) status.textContent = `Evolution sent. Tx: ${data.tx?.hash || 'submitted'}`;
        window.animatePet?.('dance');
      } catch (err) {
        if (status) status.textContent = err.message || 'Could not evolve NFT.';
      } finally {
        evolveNftButton.disabled = false;
      }
    };
  }

  if (magicLinkButton) {
    magicLinkButton.onclick = async () => {
      magicLinkButton.disabled = true;
      if (status) status.textContent = 'Generating magic restore link...';
      try {
        const data = await post('/api/wallet/magic-link', {});
        if (data.restoreUrl) {
          if (magicLinkBox) magicLinkBox.hidden = false;
          if (magicLinkInput) magicLinkInput.value = data.restoreUrl;
          if (status) status.textContent = 'Magic Link generated! Copy and save it safely.';
        }
      } catch (err) {
        if (status) status.textContent = err.message || 'Could not create magic link.';
      } finally {
        magicLinkButton.disabled = false;
      }
    };
  }

  if (copyMagicLink && magicLinkInput) {
    copyMagicLink.onclick = async () => {
      try {
        await navigator.clipboard.writeText(magicLinkInput.value);
        copyMagicLink.textContent = 'Copied!';
        setTimeout(() => { copyMagicLink.textContent = 'Copy'; }, 2000);
      } catch (_) {
        magicLinkInput.select();
      }
    };
  }

  if (form) {
    form.onsubmit = async event => {
      event.preventDefault();
      if (reply) reply.textContent = '';
      const prompt = question?.value?.trim();
      if (!wallet) await loadWallet();
      const address = walletAddress();
      if (!address) { if (status) status.textContent = 'Load the fren vault first.'; return; }
      if (ask) ask.disabled = true;
      if (status) status.textContent = 'Asking Bankr...';
      try {
        const data = await post('/api/bankr/monitor', {wallet: address, question: prompt || 'How is this fren vault looking today?', pet: petProfile()});
        if (reply) {
          reply.hidden = false;
          reply.textContent = data.reply || 'Bankr is still thinking. Try again in a moment.';
        }
        if (status) status.textContent = data.pending ? 'Bankr is still thinking.' : '';
        window.animatePet?.('wave');
      } catch (error) {
        if (status) status.textContent = error.message || 'Bankr is unavailable.';
      } finally {
        if (ask) ask.disabled = false;
      }
    };
  }

  if (refresh) refresh.onclick = loadNfts;

  syncOnchainControls();
  loadWallet();
})();
