'use strict';
(() => {
  const log = $('chatLog'), form = $('chatForm'), input = $('chatInput'), status = $('chatStatus'), send = $('chatSend');
  const modal = $('chatModal');
  const server = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');

  // Chat is now a popup dialog opened by tapping the character (or the hint),
  // not a dedicated tab.
  function openChat() {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('chat-open');
    try { input.focus(); } catch {}
  }
  function closeChat() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('chat-open');
  }
  $('chatClose')?.addEventListener('click', closeChat);
  $('chatBackdrop')?.addEventListener('click', closeChat);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal && !modal.hidden) closeChat(); });
  // Tapping the character (or the hint) opens the chat dialog.
  $('pet')?.addEventListener('click', openChat);
  $('chatHint')?.addEventListener('click', openChat);
  window.TinyFrensChat = { open: openChat, close: closeChat };

  function line(kind, text) {
    const bubble = document.createElement('p');
    bubble.className = 'chat-message ' + kind;
    bubble.textContent = text;
    log.append(bubble);
    log.scrollTop = log.scrollHeight;
  }
  function petProfile() {
    const s = read();
    return {
      name: cleanName(s.name) || 'Your fren',
      shape: s.shape === 'mascot' ? 'robot' : ['cat','blob','robot','bunny','dog','bear','frog','turtle'].includes(s.shape) ? s.shape : 'cat',
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#a474f1'
    };
  }
  line('pet', 'I can talk once the TinyFrens server is connected.');
  form.onsubmit = async event => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    const base = server();
    line('user', message);
    input.value = '';
    if (!base) {
      status.textContent = 'Connect the TinyFrens server first.';
      line('pet', 'I need my home server before I can answer.');
      return;
    }
    send.disabled = true;
    status.textContent = 'Your fren is thinking...';
    try {
      const response = await fetch(base + '/api/chat', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({message, pet: petProfile()})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Pet chat is unavailable.');
      line('pet', data.reply);
      status.textContent = '';
      window.animatePet?.('wave');
    } catch (error) {
      status.textContent = error.message || 'Pet chat is unavailable.';
      line('pet', 'I lost the signal for a second.');
    } finally {
      send.disabled = false;
      input.focus();
    }
  };
})();
