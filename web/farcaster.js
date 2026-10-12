'use strict';
/**
 * TinyFrens Farcaster Mini App SDK & Client Adapter
 * Conforms to Farcaster Frames v2 / Mini App specification.
 * Guides: https://miniapps.farcaster.xyz/docs/guides/loading
 *         https://miniapps.farcaster.xyz/docs/guides/sharing
 */
(() => {
  let context = null;
  let inFarcaster = false;
  let fcSdk = window.farcaster?.sdk || null;
  let isReadyCalled = false;

  // Detect Farcaster iframe / webview environment
  try {
    const isIframe = window.self !== window.top;
    const hasFcParam = new URLSearchParams(window.location.search).has('fc');
    inFarcaster = isIframe || hasFcParam || Boolean(window.farcaster);
  } catch {
    inFarcaster = false;
  }

  const pendingCalls = new Map();
  let rpcId = 1;

  function sendRpc(method, params = {}) {
    return new Promise((resolve) => {
      const id = rpcId++;
      pendingCalls.set(id, resolve);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          jsonrpc: '2.0',
          id,
          method,
          params
        }, '*');
      } else if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params
        }));
      }
      setTimeout(() => {
        if (pendingCalls.has(id)) {
          pendingCalls.delete(id);
          resolve(null);
        }
      }, 3000);
    });
  }

  // Handle incoming messages from Farcaster host
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.id && pendingCalls.has(data.id)) {
      const resolve = pendingCalls.get(data.id);
      pendingCalls.delete(data.id);
      resolve(data.result);
      return;
    }

    if (data.type === 'fc:frame:context' || data.method === 'fc:frame:context') {
      context = data.params || data.context || data;
      inFarcaster = true;
      window.dispatchEvent(new CustomEvent('farcaster-context', { detail: context }));
    }
  });

  async function loadSdk() {
    if (fcSdk) return fcSdk;
    if (window.farcaster?.sdk) {
      fcSdk = window.farcaster.sdk;
      return fcSdk;
    }
    try {
      const mod = await import('https://esm.sh/@farcaster/miniapp-sdk');
      fcSdk = mod.sdk || mod.default?.sdk || mod.default;
    } catch {
      try {
        const mod = await import('https://esm.sh/@farcaster/frame-sdk@0.2.0');
        fcSdk = mod.sdk || mod.default?.sdk || mod.default;
      } catch (err) {
        console.warn('Frame SDK CDN import fallback:', err.message);
      }
    }
    if (fcSdk?.context) {
      try {
        const ctx = await fcSdk.context;
        if (ctx) {
          context = ctx;
          inFarcaster = true;
          window.dispatchEvent(new CustomEvent('farcaster-context', { detail: context }));
        }
      } catch {
        // Context might resolve later
      }
    }
    return fcSdk;
  }

  /**
   * Signal to Farcaster client that UI is loaded and ready.
   * Hides the native splash screen and web loading overlay.
   */
  async function ready(options = { disableNativeGestures: false }) {
    if (isReadyCalled) return;
    isReadyCalled = true;

    // Call official SDK action
    if (fcSdk?.actions?.ready) {
      try {
        await fcSdk.actions.ready(options);
      } catch (err) {
        console.warn('sdk.actions.ready() call failed:', err);
      }
    } else if (window.farcaster?.sdk?.actions?.ready) {
      try {
        await window.farcaster.sdk.actions.ready(options);
      } catch (err) {
        console.warn('window.farcaster.sdk.actions.ready() failed:', err);
      }
    }

    // Secondary postMessage handshake for iframe / webview hosts
    if (inFarcaster) {
      sendRpc('fc:frame:ready', options);
      sendRpc('miniapp:ready', options);
    }

    // Dismiss loading overlay smoothly
    const loading = document.getElementById('fcLoadingScreen');
    if (loading) {
      loading.classList.add('fc-loading-done');
      setTimeout(() => {
        try { loading.remove(); } catch {}
      }, 500);
    }
  }

  async function init() {
    // Safety fallback: ensure splash is never stuck if network or CDN stalls
    const safetyTimer = setTimeout(() => {
      ready();
    }, 1500);

    await loadSdk();

    // Auto-call ready once interface and pet are rendered
    const callReadyWhenReady = () => {
      // Small 250ms tick to ensure CSS animations & layout are painted smoothly
      setTimeout(() => {
        clearTimeout(safetyTimer);
        ready();
      }, 250);
    };

    if (document.readyState === 'complete') {
      callReadyWhenReady();
    } else {
      window.addEventListener('load', callReadyWhenReady, { once: true });
    }
  }

  function isMiniApp() {
    return inFarcaster;
  }

  function getUser() {
    return context?.user || null;
  }

  function composeCast({ text = '', embeds = [] }) {
    const embedList = Array.isArray(embeds) ? embeds : [embeds].filter(Boolean);

    // 1. Native SDK action if present
    if (fcSdk?.actions?.composeCast) {
      return fcSdk.actions.composeCast({
        text,
        embeds: embedList
      });
    }

    if (inFarcaster) {
      sendRpc('fc:frame:composeCast', { text, embeds: embedList });
      return;
    }

    // 2. Web fallback: open Warpcast composer
    const params = new URLSearchParams();
    if (text) params.set('text', text);
    for (const url of embedList) {
      params.append('embeds[]', url);
    }
    const warpcastUrl = 'https://warpcast.com/~/compose?' + params.toString();
    window.open(warpcastUrl, '_blank', 'noopener,noreferrer');
  }

  function openUrl(url) {
    if (fcSdk?.actions?.openUrl) {
      return fcSdk.actions.openUrl(url);
    }
    if (inFarcaster) {
      sendRpc('fc:frame:openUrl', { url });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function close() {
    if (fcSdk?.actions?.close) {
      return fcSdk.actions.close();
    }
    if (inFarcaster) {
      sendRpc('fc:frame:close');
    }
  }

  window.TinyFrensFC = {
    init,
    ready,
    isMiniApp,
    getUser,
    composeCast,
    openUrl,
    close
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
