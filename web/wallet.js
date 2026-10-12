'use strict';
(() => {
  const form = $('walletForm'), question = $('walletQuestion'), ask = $('walletAsk'), status = $('walletStatus'), reply = $('walletReply');
  const refresh = $('walletRefreshNfts'), nftList = $('walletNfts');
  const vaultAddressInput = $('vaultAddressInput'), copyVaultAddress = $('copyVaultAddress'), vaultStatusChip = $('vaultStatusChip');
  const mintNftButton = $('mintNftButton'), mintCustomNftButton = $('mintCustomNftButton'), mintSubtext = $('mintSubtext');
  const mintModeEth = $('mintModeEth'), mintModeVault = $('mintModeVault'), mintModeExplanation = $('mintModeExplanation');
  const tokenIdInput = $('walletTokenId'), renameInput = $('walletRenameInput'), renameNftButton = $('walletRenameNft'), evolveNftButton = $('walletEvolveNft'), walletSaveNft = $('walletSaveNft');
  const magicLinkButton = $('magicLinkButton'), magicLinkBox = $('magicLinkBox'), magicLinkInput = $('magicLinkInput'), copyMagicLink = $('copyMagicLink');

  const server = () => String(window.TINYFRENS_SERVER || window.location.origin || '').replace(/\/$/, '');
  let wallet = null;
  let livePriceQuote = null;
  let activeMintMode = 'eth';

  function petProfile() {
    const s = read();
    return {
      name: cleanName(s.name) || 'Your fren',
      shape: s.shape === 'mascot' ? 'robot' : s.shape === 'dog' ? 'duck' : s.shape === 'bear' ? 'pig' :  ['cat','blob','robot','bunny','duck','pig','frog','turtle'].includes(s.shape) ? s.shape : 'cat',
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#a474f1',
      expression: s.expression || 'happy',
      accessory: s.accessory || 'none',
      tokenId: s.tokenId || null
    };
  }

  function identity() {
    const id = window.TinyFrensFriends?.identity?.();
    if (id?.token) return id;
    try {
      const endpoint = server();
      const saved = JSON.parse(localStorage.getItem('tinyfrens-device:' + endpoint) || 'null');
      if (saved?.token) return saved;
    } catch (_) {}
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

  function updateMintModeUi() {
    if (mintModeEth && mintModeVault) {
      if (activeMintMode === 'vault') {
        mintModeVault.classList.add('active');
        mintModeVault.style.background = '#7c5cbf';
        mintModeVault.style.color = '#fff';
        mintModeVault.style.borderColor = '#9d7feb';
        mintModeEth.classList.remove('active');
        mintModeEth.style.background = '#241d3d';
        mintModeEth.style.color = '#c8b1fa';
        mintModeEth.style.borderColor = '#4a3a6c';
        const frensFmt = livePriceQuote?.vaultFrensHuman ? Number(livePriceQuote.vaultFrensHuman).toLocaleString() : '47,619,047';
        if (mintNftButton) mintNftButton.textContent = `🏦 Mint Fren Vault · ${frensFmt} FRENS`;
        if (mintSubtext) mintSubtext.textContent = `FRENS Piggybank Vault: 100% of collateral (${frensFmt} FRENS) locked in the NFT.`;
        if (mintModeExplanation) mintModeExplanation.textContent = `Deposit ~0.002 ETH worth of FRENS (${frensFmt} FRENS) inside your companion. Unwrap it anytime to withdraw 100% back!`;
      } else {
        mintModeEth.classList.add('active');
        mintModeEth.style.background = '#7c5cbf';
        mintModeEth.style.color = '#fff';
        mintModeEth.style.borderColor = '#9d7feb';
        mintModeVault.classList.remove('active');
        mintModeVault.style.background = '#241d3d';
        mintModeVault.style.color = '#c8b1fa';
        mintModeVault.style.borderColor = '#4a3a6c';
        const ethFmt = livePriceQuote?.ethRequired ? Number(livePriceQuote.ethRequired).toLocaleString(undefined, {maximumFractionDigits: 6}) : '0.001';
        if (mintNftButton) mintNftButton.textContent = `✨ Mint TinyFren · ${ethFmt} ETH`;
        if (mintSubtext) mintSubtext.textContent = `Official 1:1 on-chain companion paid outright with ${ethFmt} ETH on Base.`;
        if (mintModeExplanation) mintModeExplanation.textContent = `Buy directly with ${ethFmt} ETH on Base.`;
      }
    }
  }

  if (mintModeEth) mintModeEth.onclick = () => { activeMintMode = 'eth'; updateMintModeUi(); };
  if (mintModeVault) mintModeVault.onclick = () => { activeMintMode = 'vault'; updateMintModeUi(); };

  async function fetchPriceQuote() {
    try {
      const base = server();
      const url = base ? base + '/api/nft/price' : '/api/nft/price';
      const res = await fetch(url);
      if (!res.ok) return;
      livePriceQuote = await res.json();
      updateMintModeUi();
    } catch (_) {}
  }

  let walletLoadAttempts = 0;
  async function loadWallet() {
    if (status) status.textContent = 'Loading fren pocket vault...';
    try {
      const id = identity();
      if (!id) {
        if (++walletLoadAttempts <= 10) {
          setTimeout(loadWallet, 400);
          return;
        }
      }
      showWallet(await post('/api/bankr/wallet', {pet: petProfile()}));
      if (status) status.textContent = 'Fren Pocket Vault connected on Base.';
      await loadNfts();
    } catch (error) {
      if (++walletLoadAttempts <= 8 && !identity()) {
        setTimeout(loadWallet, 500);
        return;
      }
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
      card.append(title, meta);

      if (nft.vaultBacked) {
        const vaultBadge = document.createElement('span');
        vaultBadge.className = 'vault-badge';
        vaultBadge.style.cssText = 'background:#3b2361;color:#ffd700;border:1px solid #7c5cbf;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;display:inline-block;margin:4px 0 6px;';
        const frensAmt = nft.lockedFrens && nft.lockedFrens !== '0' ? (Number(nft.lockedFrens) / 1e18).toLocaleString(undefined, {maximumFractionDigits: 0}) : '47,619,047';
        vaultBadge.textContent = `🏦 FRENS Vault Backed (${frensAmt} FRENS locked)`;
        card.append(vaultBadge);
      }

      const actionsRow = document.createElement('div');
      actionsRow.className = 'actions';
      actionsRow.style.margin = '4px 0 0';

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
      actionsRow.append(button);

      if (nft.vaultBacked) {
        const unwrapBtn = document.createElement('button');
        unwrapBtn.type = 'button';
        unwrapBtn.className = 'secondary';
        unwrapBtn.style.cssText = 'border-color:#e06c75;color:#ff8591;';
        unwrapBtn.textContent = '🔨 Unwrap Fren';
        unwrapBtn.title = 'Burns the NFT and returns 100% of locked FRENS to your wallet';
        unwrapBtn.onclick = async () => {
          if (!confirm(`Unwrap TinyFren #${nft.tokenId}? The NFT will be burned and 100% of the locked FRENS will be returned to your wallet.`)) return;
          if (status) status.textContent = `Unwrapping TinyFren #${nft.tokenId}...`;
          unwrapBtn.disabled = true;
          try {
            const uData = await post('/api/wallet/unwrap-nft', { tokenId: nft.tokenId });
            if (status) status.textContent = uData.message || `Unwrapped TinyFren #${nft.tokenId}!`;
            if (uData.pet) savePetLook(uData.pet);
            await loadNfts();
            window.animatePet?.('dance');
          } catch (err) {
            if (status) status.textContent = err.message || 'Could not unwrap Fren.';
          } finally {
            unwrapBtn.disabled = false;
          }
        };
        actionsRow.append(unwrapBtn);
      }

      card.append(actionsRow);
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
      const isVault = (activeMintMode === 'vault');
      if (status) status.textContent = isVault ? 'Minting FRENS Piggybank Vault on Base...' : 'Minting your TinyFren NFT in ETH on Base...';
      try {
        const data = await post('/api/wallet/mint', { mode: activeMintMode });
        if (data.success && data.nft) {
          savePetLook(data.pet);
          if (tokenIdInput) tokenIdInput.value = String(data.nft.tokenId || '');
          if (renameInput) renameInput.value = cleanName(data.pet.name) || '';
          const mintLabel = isVault ? 'FRENS Piggybank Vault' : 'TinyFren';
          if (status) status.textContent = `🎉 Minted ${mintLabel} #${data.nft.tokenId}! Your fren is wearing their 1:1 on-chain look.`;
          await loadNfts();
          window.animatePet?.('dance');
        }
      } catch (err) {
        if (status) status.textContent = err.message || 'Minting error. Check balance.';
      } finally {
        mintNftButton.disabled = false;
      }
    };
  }

  if (mintCustomNftButton) {
    mintCustomNftButton.onclick = async () => {
      mintCustomNftButton.disabled = true;
      const cur = petProfile();
      const isVault = (activeMintMode === 'vault');
      if (status) status.textContent = `Minting custom ${cur.shape} (${cur.expression}) via ${isVault ? 'FRENS Vault' : 'ETH'} on Base...`;
      try {
        const data = await post('/api/wallet/mint', {
          mode: activeMintMode,
          customTraits: {
            shape: cur.shape,
            color: cur.color,
            expression: cur.expression,
            accessory: cur.accessory
          },
          name: cur.name
        });
        if (data.success && data.nft) {
          savePetLook(data.pet);
          if (tokenIdInput) tokenIdInput.value = String(data.nft.tokenId || '');
          if (renameInput) renameInput.value = cleanName(data.pet.name) || '';
          if (status) status.textContent = `🎉 Minted custom TinyFren #${data.nft.tokenId}! Your custom designed companion is now on-chain.`;
          await loadNfts();
          window.animatePet?.('dance');
        }
      } catch (err) {
        if (status) status.textContent = err.message || 'Custom mint error. Check balance.';
      } finally {
        mintCustomNftButton.disabled = false;
      }
    };
  }

  if (walletSaveNft) {
    walletSaveNft.onclick = async () => {
      const tokenId = currentTokenId();
      if (!tokenId) { if (status) status.textContent = 'Pick the TinyFren token to save changes to first.'; return; }
      walletSaveNft.disabled = true;
      if (status) status.textContent = `Saving custom look to TinyFren #${tokenId} (50% burn / 50% treasury)...`;
      try {
        const cur = petProfile();
        const data = await post('/api/wallet/save-nft-changes', {
          tokenId,
          name: renameInput?.value?.trim() || cur.name,
          customTraits: { color: cur.color, expression: cur.expression, accessory: cur.accessory }
        });
        if (data.pet) savePetLook(data.pet);
        if (status) status.textContent = data.message || `Saved changes to TinyFren #${tokenId}!`;
        await loadNfts();
        window.animatePet?.('dance');
      } catch (err) {
        if (status) status.textContent = err.message || 'Could not save NFT changes.';
      } finally {
        walletSaveNft.disabled = false;
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
  const legacyTools = document.querySelector('#screen-wallet > details');
  legacyTools?.addEventListener('toggle', () => { if (legacyTools.open && !wallet) loadWallet(); });
  window.addEventListener('tinyfrens-identity-ready', () => { if (legacyTools?.open) { walletLoadAttempts = 0; loadWallet(); } });
  window.addEventListener('focus', () => { if (legacyTools?.open && !wallet) loadWallet(); });
})();
