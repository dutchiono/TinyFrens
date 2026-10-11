'use strict';
/**
 * TinyFrens Farcaster Mini App SDK & Client Adapter
 * Conforms to Farcaster Frames v2 / Mini App specification.
 */
(() => {
  let context = null;
  let inFarcaster = false;

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
      // Timeout fallback
      setTimeout(() => {
        if (pendingCalls.has(id)) {
          pendingCalls.delete(id);
          resolve(null);
        }
      }, 3000);
    });
  }

  // Handle incoming messages from Farcaster parent container
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    // Check for JSON-RPC response
    if (data.id && pendingCalls.has(data.id)) {
      const resolve = pendingCalls.get(data.id);
      pendingCalls.delete(data.id);
      resolve(data.result);
      return;
    }

    // Context broadcast from Farcaster host
    if (data.type === 'fc:frame:context' || data.method === 'fc:frame:context') {
      context = data.params || data.context || data;
      inFarcaster = true;
      window.dispatchEvent(new CustomEvent('farcaster-context', { detail: context }));
    }
  });

  async function init() {
    // Check if official @farcaster/frame-sdk is loaded on window
    if (window.farcaster?.sdk?.actions?.ready) {
      try {
        await window.farcaster.sdk.actions.ready();
        context = await window.farcaster.sdk.context;
        inFarcaster = true;
        return;
      } catch (err) {
        console.warn('Farcaster SDK init error:', err);
      }
    }

    // Otherwise use standard postMessage handshake
    if (inFarcaster) {
      sendRpc('fc:frame:ready');
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

    // 1. If running inside Farcaster client with native action
    if (window.farcaster?.sdk?.actions?.composeCast) {
      return window.farcaster.sdk.actions.composeCast({
        text,
        embeds: embedList
      });
    }

    if (inFarcaster) {
      sendRpc('fc:frame:composeCast', { text, embeds: embedList });
      return;
    }

    // 2. Browser fallback: open Warpcast composer intent
    const params = new URLSearchParams();
    if (text) params.set('text', text);
    for (const url of embedList) {
      params.append('embeds[]', url);
    }
    const warpcastUrl = 'https://warpcast.com/~/compose?' + params.toString();
    window.open(warpcastUrl, '_blank', 'noopener,noreferrer');
  }

  function openUrl(url) {
    if (window.farcaster?.sdk?.actions?.openUrl) {
      return window.farcaster.sdk.actions.openUrl(url);
    }
    if (inFarcaster) {
      sendRpc('fc:frame:openUrl', { url });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function close() {
    if (window.farcaster?.sdk?.actions?.close) {
      return window.farcaster.sdk.actions.close();
    }
    if (inFarcaster) {
      sendRpc('fc:frame:close');
    }
  }

  window.TinyFrensFC = {
    init,
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
