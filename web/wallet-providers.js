(() => {
  'use strict';
  const providers = new Map();
  function announce(event) {
    const {info, provider} = event.detail || {};
    if (!provider?.request || !info?.uuid || typeof info.name !== 'string') return;
    const existing = [...providers.entries()].find(([, item]) => item.provider === provider);
    if (existing && !existing[0].startsWith('legacy-')) return;
    if (existing) providers.delete(existing[0]);
    providers.set(info.uuid, {name:info.name.slice(0,80), provider});
    window.dispatchEvent(new Event('tinyfrens-providers-changed'));
  }
  window.addEventListener('eip6963:announceProvider', announce);
  function discover() {
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    const legacy = window.ethereum?.providers || [window.ethereum, window.phantom?.ethereum];
    for (const provider of legacy.filter(Boolean)) {
      if (!provider.request || [...providers.values()].some(item => item.provider === provider)) continue;
      const name = provider.isRabby ? 'Rabby' : provider.isPhantom ? 'Phantom' : provider.isRainbow ? 'Rainbow' : provider.isMetaMask ? 'MetaMask' : 'Browser wallet';
      providers.set('legacy-' + providers.size, {name, provider});
    }
    return providers;
  }
  window.TinyFrensWalletProviders = {discover};
  discover();
})();
