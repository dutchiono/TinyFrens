(() => {
  let sequence = 0;
  const pending = new Map();
  window.onTurtleResponse = ({requestId, result}) => {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId); clearTimeout(request.timer);
    result.error ? request.reject(new Error(result.error)) : request.resolve(result);
  };
  window.TinyFrensTurtleAPI = async (base, path, body) => {
    if (window.TinyFrensDesktop?.turtleRequest) return TinyFrensDesktop.turtleRequest(base, path, body);
    const android = window.PetAndroid?.turtleRequest;
    const ios = window.webkit?.messageHandlers?.petTurtle;
    if (android || ios) return new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Connection timed out. Please retry.')); }, 45000);
      pending.set(requestId, {resolve, reject, timer});
      try {
        if (android) PetAndroid.turtleRequest(base, path, JSON.stringify(body), requestId);
        else ios.postMessage({server:base, path, body, requestId});
      } catch (error) { pending.delete(requestId); clearTimeout(timer); reject(error); }
    });
    const response = await fetch(base + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(20000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Turtle connection unavailable');
    return data;
  };
  window.removeImportedWallet = async address => {
    const native = window.PetAndroid?.turtleRequest || window.TinyFrensDesktop?.turtleRequest;
    if (native) await window.TinyFrensTurtleAPI(window.TINYFRENS_SERVER, '/native/remove-wallet', {address});
    const belongs = nft => (nft.wallet || nft.originalOwner || '').toLowerCase() === address.toLowerCase();
    let saved = []; try { saved = JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]'); } catch {}
    localStorage.setItem('tinyfrens-companions', JSON.stringify(saved.filter(nft => !belongs(nft))));
    try { if (belongs(JSON.parse(localStorage.getItem('tinyfrens-hood-turtle') || '{}'))) localStorage.removeItem('tinyfrens-hood-turtle'); } catch {}
    window.dispatchEvent(new Event('tinyfrens-wallet-link-changed'));
  };
  window.clearImportedTurtle = () => {
    window.PetAndroid?.clearTurtle?.();
    window.TinyFrensDesktop?.clearTurtle?.();
    localStorage.removeItem('tinyfrens-hood-turtle');
    localStorage.removeItem('tinyfrens-companions');
    window.dispatchEvent(new Event('tinyfrens-wallet-link-changed'));
  };
})();
