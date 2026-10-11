'use strict';
(() => {
  const form = $('walletForm'), address = $('walletAddress'), question = $('walletQuestion'), ask = $('walletAsk'), status = $('walletStatus'), reply = $('walletReply');
  const server = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  const storage = 'tinyfrens-wallet-address';
  function petProfile() {
    const s = read();
    return {
      name: cleanName(s.name) || 'Your fren',
      shape: s.shape === 'mascot' ? 'robot' : ['cat','blob','robot','bunny','dog','bear','frog','turtle'].includes(s.shape) ? s.shape : 'cat',
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#a474f1'
    };
  }
  try { address.value = localStorage.getItem(storage) || ''; } catch {}
  async function checkStatus() {
    const base = server();
    if (!base) { status.textContent = 'Connect the TinyFrens server first.'; return; }
    try {
      const response = await fetch(base + '/api/bankr/status');
      const data = await response.json();
      status.textContent = data.connected ? 'Bankr API is connected.' : 'Bankr API key is not configured on the server yet.';
    } catch {
      status.textContent = 'Could not reach the Bankr bridge.';
    }
  }
  form.onsubmit = async event => {
    event.preventDefault();
    const base = server(), wallet = address.value.trim(), prompt = question.value.trim();
    reply.textContent = '';
    if (!base) { status.textContent = 'Connect the TinyFrens server first.'; return; }
    if (!wallet) { status.textContent = 'Enter a wallet address first.'; address.focus(); return; }
    try { localStorage.setItem(storage, wallet); } catch {}
    ask.disabled = true;
    status.textContent = 'Asking Bankr...';
    try {
      const response = await fetch(base + '/api/bankr/monitor', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({wallet, question: prompt, pet: petProfile()})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Bankr is unavailable.');
      reply.textContent = data.reply || 'Bankr is still thinking. Try again in a moment.';
      status.textContent = data.pending ? 'Bankr is still thinking.' : '';
      window.animatePet?.('wave');
    } catch (error) {
      status.textContent = error.message || 'Bankr is unavailable.';
    } finally {
      ask.disabled = false;
    }
  };
  checkStatus();
})();
