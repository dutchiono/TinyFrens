/* Games use the same wallet proofs and collection animation rigs as the overlays. */
(() => {
  const adapters = new Set(['hood-turtles-v1', 'tinyfrens-robots-v1', 'nubs-v1', 'bots-computers-v1']);
  let inventory = null;
  const clear = () => { inventory = null; };
  const key = nft => window.TinyFrensCompanionKey(nft);
  const animated = nft => nft?.active === true && Date.now() < nft.validUntil * 1000 &&
    window.TinyFrensNFTDiscovery.isSupported({chainId:nft.chainId, contract:nft.originalAddress}) &&
    adapters.has(nft.companion?.adapter) && nft.companion.frames?.length > 1 &&
    nft.companion.frames.every(frame => /^data:image\/(png|svg\+xml);base64,/.test(frame)) &&
    nft.companion.frameMs > 0;
  function identity() {
    const base = String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
    const device = window.TinyFrensFriends?.identity?.() || JSON.parse(localStorage.getItem('tinyfrens-device:' + base) || 'null');
    if (!device?.token) throw Error('Connect your wallet in My NFTs to choose a player.');
    return device;
  }
  function post(path, body = {}) {
    return window.TinyFrensTurtleAPI(window.TINYFRENS_SERVER, path, {token:identity().token, ...body});
  }
  async function list() {
    const token = identity().token;
    if (inventory?.token === token && Date.now() < inventory.until) return inventory.data;
    const data = await post('/api/wallet-link/nfts');
    const unique = new Map();
    for (const nft of data.nfts || []) if (window.TinyFrensNFTDiscovery.isSupported({chainId:nft.chainId, contract:nft.originalAddress})) unique.set(key(nft), nft);
    const result = {items:[...unique.values()], errors:data.errors || [], partial:data.partial};
    if (!data.partial) inventory = {token, until:Date.now() + 300000, data:result};
    return result;
  }
  async function prepare(nft) {
    const data = await post('/api/featured/companion', {tokenId:nft.tokenId, originalAddress:nft.originalAddress, chainId:nft.chainId});
    if (key(data) !== key(nft) || !animated(data)) throw Error('This NFT needs verified ownership and an available animation to play. Refresh your NFTs and try again.');
    return data;
  }
  function sprite(nft) {
    if (!animated(nft)) throw Error('Choose a verified animated NFT.');
    const element = document.createElement('img');
    element.className = 'game-fren-img'; element.alt = nft.name;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {element, update(time, moving, direction) {
      if (!animated(nft)) throw Error('Your NFT ownership check expired. Refresh before playing again.');
      const rig = nft.companion;
      const src = moving && !reduced ? rig.frames[Math.floor(time / rig.frameMs) % rig.frames.length] : rig.idle || rig.frames[0];
      if (element.getAttribute('src') !== src) element.src = src;
      element.style.transform = `scaleX(${direction < 0 ? -1 : 1})`;
    }};
  }
  window.addEventListener('tinyfrens-account-synced', clear);
  window.addEventListener('tinyfrens-wallet-link-changed', clear);
  window.TinyFrensGamePlayers = {list, clear, prepare, sprite, animated, key};
})();
