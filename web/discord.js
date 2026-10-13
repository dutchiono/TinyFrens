'use strict';
/**
 * TinyFrens — Discord Activity client adapter (Phase 2).
 *
 * Discord Activities run in an iframe and communicate with the client through the
 * Embedded App SDK (@discord/embedded-app-sdk), loaded from Discord's proxy. We:
 *   1. Detect the Activity iframe (window.frameElement + the SDK global).
 *   2. Run the SDK handshake (authorize with the OAuth2 code / authenticate with an
 *      access token) to learn the current channel_id + user.
 *   3. Exchange the code with our server (/api/discord/token) to get an access
 *      token, then map the channel to a shared party room (dc:<channel_id>) so a
 *      Discord channel == a public party room, exactly like Telegram groups.
 *   4. Enable the in-app floating companion.
 *
 * Note: Activities currently require the app to be launched inside a voice channel
 * (or the App Launcher). URL mapping/proxy is configured in the Discord dev portal;
 * see TELEGRAM-DISCORD.md.
 */
(() => {
  const CLIENT_ID = window.TINYFRENS_DISCORD_CLIENT_ID || '';
  const server = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');

  // Discord serves the SDK from its own proxy; dynamic import keeps the main app
  // untouched when running as a normal browser PWA.
  const SDK_URLS = [
    'https://discord.com/api/v10/activities/@discord/embedded-app-sdk/1.1.0/index.js',
    'https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk@1.1.0/dist/index.js',
  ];

  async function loadSdk() {
    for (const url of SDK_URLS) {
      try {
        const mod = await import(url);
        return (mod && (mod.DiscordSDK || mod.default)) || null;
      } catch { /* try next */ }
    }
    return null;
  }

  async function init() {
    const inIframe = (() => { try { return window.self !== window.top; } catch { return false; } })();
    if (!inIframe) { window.TinyFrensDiscord = { active: false }; return; }

    const sdk = await loadSdk();
    if (!sdk) { window.TinyFrensDiscord = { active: false, reason: 'sdk-unavailable' }; return; }

    const discordSdk = new sdk.DiscordSDK(CLIENT_ID);
    await discordSdk.ready();
    window.__TINYFRENS_DEFER_AUTH__ = true;

    let code = '';
    try {
      const { code: authCode } = await discordSdk.commands.authorize({
        client_id: CLIENT_ID,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify', 'guilds'],
      });
      code = authCode || '';
    } catch (err) {
      console.warn('Discord authorize failed:', err && err.message);
    }

    let accessToken = '';
    if (code) {
      try {
        const response = await fetch(server() + '/api/discord/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await response.json();
        if (response.ok) accessToken = data.access_token || '';
      } catch (err) { console.warn('Discord token exchange failed:', err && err.message); }
    }

    let channelId = '';
    try {
      const channel = await discordSdk.commands.getChannel();
      channelId = (channel && channel.channel_id) || '';
    } catch { /* optional */ }

    // Dismiss the shared splash.
    const splash = document.getElementById('fcLoadingScreen');
    if (splash) { splash.classList.add('fc-loading-done'); setTimeout(() => { try { splash.remove(); } catch {} }, 500); }

    async function joinChannelRoom() {
      const api = window.TinyFrensFriends;
      let tries = 0;
      const attempt = () => {
        if (api && api.connected()) {
          if (channelId && window.TinyFrensParty) window.TinyFrensParty.joinChat('discord', channelId, 'this Discord channel');
          else if (window.TinyFrensParty) window.TinyFrensParty.joinPublic();
        } else if (tries++ < 25) setTimeout(attempt, 400);
      };
      attempt();
    }
    joinChannelRoom();

    window.TinyFrensDiscord = { active: true, discordSdk, accessToken, channelId };

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
