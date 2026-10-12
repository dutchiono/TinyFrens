/* Client-side, read-only EVM NFT discovery. No wallet signatures or private keys. */
(() => {
  'use strict';
  const CHAINS = [
    {id:1, name:'Ethereum', api:'https://eth.blockscout.com/api/v2'},
    {id:8453, name:'Base', api:'https://base.blockscout.com/api/v2'},
    {id:42161, name:'Arbitrum', api:'https://arbitrum.blockscout.com/api/v2'},
    {id:10, name:'Optimism', api:'https://optimism.blockscout.com/api/v2'},
    {id:137, name:'Polygon', api:'https://polygon.blockscout.com/api/v2'},
    {id:56, name:'BNB Chain', api:'https://bsc.blockscout.com/api/v2'},
    {id:4663, name:'Robinhood Chain', api:'https://robinhoodchain.blockscout.com/api/v2'}
  ];
  const HOOD_TURTLES = '0xca28587b61eac19a87dfcfd9420870867a916675';
  const addressOK = address => /^0x[a-fA-F0-9]{40}$/.test(address);
  function metadata(item) {
    const value = item.metadata;
    if (value && typeof value === 'object') return value;
    if (typeof value === 'string') { try { return JSON.parse(value); } catch {} }
    return {};
  }
  function imageUrl(value) {
    if (typeof value !== 'string') return '';
    if (value.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + value.slice(7).replace(/^ipfs\//, '');
    if (/^https:\/\//i.test(value)) return value;
    return '';
  }
  async function scanChain(address, chain, signal) {
    let params = {type:'ERC-721,ERC-1155'};
    const seen = new Map();
    let partial = false;
    for (let page = 0; page < 10; page++) {
      const url = chain.api + '/addresses/' + encodeURIComponent(address) + '/nft?' + new URLSearchParams(params);
      const res = await fetch(url, {signal, headers:{Accept:'application/json'}});
      if (!res.ok) throw new Error(chain.name + ' indexer returned HTTP ' + res.status);
      const body = await res.json();
      if (!Array.isArray(body.items)) throw new Error(chain.name + ' indexer returned invalid NFT data');
      for (const entry of body.items) {
        const token = entry.token || {};
        const contract = token.address_hash || token.address || '';
        const tokenId = String(entry.id ?? '');
        if (!addressOK(contract) || !/^\d+$/.test(tokenId)) continue;
        const standard = String(token.type || 'ERC-721').toUpperCase();
        const meta = metadata(entry);
        const key = chain.id + ':' + contract.toLowerCase() + ':' + tokenId;
        const image = entry.image_url || meta.image_url || meta.image || '';
        seen.set(key, {
          chain:chain.name, chainId:chain.id, wallet:address, contract,
          tokenId, standard,
          collection:String(token.name || token.symbol || 'NFT collection'),
          name:String(meta.name || token.name || 'NFT') + ' #' + tokenId,
          image:imageUrl(image),
          hoodTurtle:chain.id === 4663 && contract.toLowerCase() === HOOD_TURTLES
        });
      }
      if (!body.next_page_params) break;
      if (page === 9) { partial = true; break; }
      params = {type:'ERC-721,ERC-1155', ...body.next_page_params};
    }
    return {nfts:[...seen.values()], partial};
  }
  async function discover(addresses, onProgress) {
    const valid = [...new Set(addresses.filter(addressOK).map(a=>a.toLowerCase()))];
    if (!valid.length) return {nfts:[], errors:[], partial:false};
    const jobs = valid.flatMap(address=>CHAINS.map(chain=>({address,chain})));
    const results = [], errors = [];
    let cursor = 0;
    async function worker() {
      while (cursor < jobs.length) {
        const {address,chain} = jobs[cursor++];
        try {
          const controller = new AbortController();
          const timeout = setTimeout(()=>controller.abort(), 18000);
          try {
            const result = await scanChain(address,chain,controller.signal);
            results.push(result);
          } finally { clearTimeout(timeout); }
        } catch(error) {
          errors.push(chain.name + ' (' + address.slice(0,6) + '…): ' + (error.name === 'AbortError' ? 'timeout' : error.message));
        }
        onProgress?.(results.length + errors.length, jobs.length);
      }
    }
    await Promise.all(Array.from({length:Math.min(4,jobs.length)},worker));
    if (!results.length) throw new Error('All NFT indexers failed: ' + errors.slice(0,3).join('; '));
    const unique = new Map();
    for (const result of results) for (const nft of result.nfts) unique.set(nft.chainId + ':' + nft.contract.toLowerCase() + ':' + nft.tokenId, nft);
    return {nfts:[...unique.values()], errors, partial:errors.length > 0 || results.some(r=>r.partial)};
  }
  window.TinyFrensNFTDiscovery = {discover, chains:CHAINS};
})();
