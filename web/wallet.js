'use strict';
(() => {
  const form = $('walletForm'), question = $('walletQuestion'), ask = $('walletAsk'), status = $('walletStatus'), reply = $('walletReply');
  const info = $('walletInfo'), load = $('walletLoad'), refresh = $('walletRefreshNfts'), nftList = $('walletNfts');
  const server = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  let wallet = null;
  function petProfile() {
    const s = read();
    return {
      name: cleanName(s.name) || 'Your fren',
      shape: s.shape === 'mascot' ? 'robot' : ['cat','blob','robot','bunny','dog','bear','frog','turtle'].includes(s.shape) ? s.shape : 'cat',
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#a474f1',
      expression: s.expression || 'joyful',
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
  function showWallet(data) {
    wallet = data;
    const lines = [];
    if (data.evmAddress) lines.push('EVM: ' + data.evmAddress);
    if (data.solAddress) lines.push('Solana: ' + data.solAddress);
    if (!lines.length) lines.push('No wallet address came back yet.');
    if (data.message) lines.push(data.message);
    info.textContent = lines.join('\n');
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
    if (!response.ok) throw new Error(data.error || 'Bankr is unavailable.');
    return data;
  }
  async function loadWallet() {
    status.textContent = 'Loading fren wallet...';
    try {
      showWallet(await post('/api/bankr/wallet', {pet: petProfile()}));
      status.textContent = wallet.partner ? 'This fren has its own Bankr wallet.' : 'Using the shared agent wallet for now.';
    } catch (error) {
      status.textContent = error.message || 'Could not load the fren wallet.';
    }
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
    nftList.replaceChildren();
    if (!nfts.length) {
      const p = document.createElement('p');
      p.className = 'small';
      p.textContent = 'No NFTs found yet. Send one to the fren wallet address, then refresh.';
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
      button.textContent = 'Become this';
      button.onclick = async () => {
        status.textContent = 'Letting your fren inspect that NFT...';
        try {
          const data = await post('/api/bankr/transform', {nft});
          savePetLook(data.pet);
          status.textContent = 'Your fren adopted ' + nftTitle(nft) + '.';
        } catch (error) {
          status.textContent = error.message || 'Could not transform your fren.';
        }
      };
      card.append(title, meta, button);
      nftList.append(card);
    }
  }
  async function loadNfts() {
    status.textContent = 'Checking the fren wallet for NFTs...';
    try {
      if (!wallet) await loadWallet();
      const data = await post('/api/bankr/nfts', {});
      drawNfts(data.nfts || []);
      status.textContent = (data.nfts || []).length ? 'Pick an NFT for your fren to adopt.' : 'No NFTs found in the fren wallet yet.';
    } catch (error) {
      status.textContent = error.message || 'Could not refresh NFTs.';
    }
  }
  form.onsubmit = async event => {
    event.preventDefault();
    reply.textContent = '';
    const prompt = question.value.trim();
    if (!wallet) await loadWallet();
    const address = walletAddress();
    if (!address) { status.textContent = 'Load the fren wallet first.'; return; }
    ask.disabled = true;
    status.textContent = 'Asking Bankr...';
    try {
      const data = await post('/api/bankr/monitor', {wallet: address, question: prompt || 'How is this fren wallet looking today?', pet: petProfile()});
      reply.textContent = data.reply || 'Bankr is still thinking. Try again in a moment.';
      status.textContent = data.pending ? 'Bankr is still thinking.' : '';
      window.animatePet?.('wave');
    } catch (error) {
      status.textContent = error.message || 'Bankr is unavailable.';
    } finally {
      ask.disabled = false;
    }
  };
  load.onclick = loadWallet;
  refresh.onclick = loadNfts;
  loadWallet();
})();
