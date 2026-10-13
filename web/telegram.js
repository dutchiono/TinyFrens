'use strict';
/**
 * TinyFrens — Telegram Mini App client adapter.
 *
 * Mirrors web/farcaster.js. When TinyFrens is opened inside Telegram, the client
 * injects window.Telegram.WebApp. We:
 *   1. Signal readiness + expand to full height, and theme the header.
 *   2. Authenticate: send the signed initData to our server, which validates it
 *      and returns the SAME {id,token,code} identity the friends relay uses — so
 *      friends.js / party.js work unchanged inside Telegram.
 *   3. Auto-join the right "party room": a Telegram group becomes a shared room
 *      (tg:<chat id>); a start_param becomes a private room code; otherwise the
 *      public room. This is how a chat == a public party room.
 *   4. Enable the in-app floating companion ("hover" inside Telegram).
 *
 * A true OS-level overlay cannot exist inside Telegram (it is a sandboxed iframe);
 * see companion.js for the closest equivalent and TELEGRAM-DISCORD.md for notes.
 */
(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  // telegram-web-app.js also defines WebApp in ordinary browsers. Signed launch
  // data is the boundary that makes this an actual Telegram session.
  const active = Boolean(tg && tg.initData);
  if (active) window.__TINYFRENS_DEFER_AUTH__ = true; // tell friends.js to wait for us
  if (!active) { window.TinyFrensTelegram = { active: false }; return; }

  const server = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  const storageKey = () => 'tinyfrens-device:' + server();

  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor && tg.setHeaderColor('#17142a');
    tg.setBackgroundColor && tg.setBackgroundColor('#17142a');
    tg.onEvent('backButtonClicked', () => window.showScreen && window.showScreen('pet'));
  } catch (err) { /* non-fatal: keep the app usable in a plain browser too */ }

  // The generic splash is shared with Farcaster; dismiss it for Telegram too.
  function dismissSplash() {
    const el = document.getElementById('fcLoadingScreen');
    if (!el) return;
    el.classList.add('fc-loading-done');
    setTimeout(() => { try { el.remove(); } catch {} }, 500);
  }
  dismissSplash();

  function haptic(style) {
    try { tg.HapticFeedback && tg.HapticFeedback.impactOccurred && tg.HapticFeedback.impactOccurred(style || 'light'); } catch {}
  }

  async function auth() {
    const initData = tg.initData || '';
    if (!initData) return null;
    try {
      const response = await fetch(server() + '/api/telegram/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Telegram auth failed');
      localStorage.setItem(storageKey(), JSON.stringify({ id: data.id, token: data.token, code: data.code }));
      // Reuse friends.js' own connect path so its enabled/identity state is set
      // from the identity we just stored (no throwaway device registration).
      const input = document.getElementById('friendsServer');
      if (input) input.value = server();
      const connectButton = document.getElementById('connectFriends');
      if (connectButton) connectButton.click();
      else window.TinyFrensFriends && window.TinyFrensFriends.connect();
      return data;
    } catch (err) {
      console.warn('Telegram auth:', err && err.message);
      const status = document.getElementById('partyStatus');
      if (status) status.textContent = 'Telegram sign-in failed: ' + (err && err.message);
      return null;
    }
  }

  function joinChatRoom(data) {
    const chat = tg.initDataUnsafe && tg.initDataUnsafe.chat;
    const start = String(data?.startParam || '').toLowerCase();
    const routes = { home: 'pet', account: 'settings', wallet: 'wallet', party: 'party' };
    let tries = 0;
    const attempt = () => {
      const api = window.TinyFrensFriends;
      if (api && api.connected()) {
        if ((chat && chat.id != null || data?.chatInstance) && window.TinyFrensParty) {
          const room = chat && chat.id != null ? String(chat.id) : String(data.chatInstance);
          window.TinyFrensParty.joinChat('telegram', room, chat?.title || 'this Telegram chat');
        } else if (data && data.startParam && !routes[start] && window.TinyFrensParty) {
          const code = String(data.startParam).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24);
          if (code.length >= 3) window.TinyFrensParty.joinPrivate(code);
          else window.TinyFrensParty.joinPublic();
        } else if (window.TinyFrensParty) {
          window.TinyFrensParty.joinPublic();
        }
        if (routes[start] && window.showScreen) window.showScreen(routes[start]);
      } else if (tries++ < 25) {
        setTimeout(attempt, 400);
      }
    };
    attempt();
  }

  function share() {
    const url = 'https://t.me/share/url?url=' + encodeURIComponent('https://tinyfrens.lol/web/') +
      '&text=' + encodeURIComponent('My tiny fren says hi 🐾');
    try { tg.openTelegramLink(url); } catch { window.open(url, '_blank', 'noopener'); }
  }

  auth().then(joinChatRoom);
  window.TinyFrensTelegram = { active: true, tg, auth, share, haptic };
  window.TinyFrensCompanion && window.TinyFrensCompanion.enable('telegram');
})();
