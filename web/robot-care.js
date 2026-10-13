/* Robots v1 Tamagotchi economy client.
 *
 * The care *simulation* stays in pet-engine.js; the server owns only what touches
 * money (docs/tamagotchi-robots.md §6.1). This module is the web client for that
 * server contract: it finds which Robots v1 the player is caring for, shows the
 * FRENS balance and today's free allowance, reports care actions, and collects the
 * game earn-back. It never simulates care and never blocks offline play.
 *
 * Endpoints (robots-only, device-token auth, fresh on-chain ownerOf server-side):
 *   POST /api/robots/care        {tokenId}          -> {allowance, prices, actions, balance, creditsPerFrens}
 *   POST /api/robots/care/action {tokenId, action}  -> {allowed, free, charged, requiresPayment?, priceFrens?, balance?}
 *   POST /api/robots/game        {tokenId, game}    -> {granted, balance}
 */
(() => {
  'use strict';
  const ROBOTS = {chainId: 8453, contract: '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff', adapter: 'tinyfrens-robots-v1'};
  const CHOICE_KEY = 'tinyfrens-robot-pet';
  const base = () => String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
  const key = nft => window.TinyFrensCompanionKey(nft);

  function identity() {
    try {
      const device = window.TinyFrensFriends?.identity?.() || JSON.parse(localStorage.getItem('tinyfrens-device:' + base()) || 'null');
      return device?.token ? device : null;
    } catch { return null; }
  }

  // A verified Robots v1 companion, as stored in `tinyfrens-companions`.
  function isRobot(nft) {
    if (!nft || nft.chainId !== ROBOTS.chainId) return false;
    if (String(nft.originalAddress || '').toLowerCase() !== ROBOTS.contract) return false;
    return nft.companion?.adapter ? nft.companion.adapter === ROBOTS.adapter : true;
  }

  function robots() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]'); } catch { saved = []; }
    return (Array.isArray(saved) ? saved : []).filter(isRobot);
  }

  // The robot the care screen is driving: the remembered choice, else the only one.
  function active() {
    const all = robots();
    if (!all.length) return null;
    if (all.length === 1) return all[0];
    let chosen = null; try { chosen = localStorage.getItem(CHOICE_KEY); } catch {}
    return all.find(nft => key(nft) === chosen) || all[0];
  }

  function setActive(nft) {
    if (!nft) return;
    try { localStorage.setItem(CHOICE_KEY, key(nft)); } catch {}
  }

  async function post(path, body) {
    const device = identity();
    if (!device) throw new Error('Connect your wallet to care for your robot.');
    return window.TinyFrensTurtleAPI(base(), path, {token: device.token, ...body});
  }

  // ---- formatting (pure, unit-tested) -------------------------------------

  function formatNumber(value) {
    const text = String(Math.round(value * 100) / 100);
    const [whole, fraction] = text.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction ? grouped + '.' + fraction : grouped;
  }

  // Internal balances are integer credits; everything user-facing is FRENS.
  function fmtFrens(credits, creditsPerFrens) {
    if (credits == null || !creditsPerFrens) return null;
    return formatNumber(credits / creditsPerFrens);
  }

  function frensLabel(credits, creditsPerFrens) {
    const frens = fmtFrens(credits, creditsPerFrens);
    return frens == null ? null : frens + ' FRENS';
  }

  // Human text for a /api/robots/care/action result (pure).
  function describe(result) {
    if (!result) return '';
    if (result.blocked) return result.message || 'Care is unavailable right now.';
    if (result.requiresPayment) {
      const price = result.priceFrens != null ? result.priceFrens.toLocaleString('en-US') + ' FRENS' : 'FRENS';
      const have = frensLabel(result.balance, result.creditsPerFrens);
      return "Today's free actions are used up. This costs " + price + (have ? ' (you have ' + have + ').' : '.');
    }
    const charged = frensLabel(result.charged, result.creditsPerFrens);
    if (result.free) {
      const left = result.allowance?.remaining;
      return left == null ? 'Free today.' : 'Free — ' + left + ' free action' + (left === 1 ? '' : 's') + ' left today.';
    }
    return charged ? 'Charged ' + charged + '.' : 'Done.';
  }

  // ---- server calls -------------------------------------------------------

  async function status(nft) {
    const pet = nft || active();
    if (!pet || !identity()) return null;
    return post('/api/robots/care', {tokenId: pet.tokenId});
  }

  // Report one care action. Never blocks the local care loop: on any failure it
  // resolves with `offline: true` so the pet keeps working exactly as before.
  async function act(action, nft) {
    const pet = nft || active();
    if (!pet || !identity()) return {offline: true};
    try {
      const result = await post('/api/robots/care/action', {tokenId: pet.tokenId, action});
      return {...result, offline: false};
    } catch (error) {
      return {offline: true, error: error.message};
    }
  }

  async function game(id, nft) {
    const pet = nft || active();
    if (!pet || !identity() || !id) return null;
    try { return await post('/api/robots/game', {tokenId: pet.tokenId, game: id}); }
    catch { return null; }
  }

  async function balance(nft) {
    try {
      const data = await status(nft);
      return data ? {balance: data.balance, creditsPerFrens: data.creditsPerFrens, allowance: data.allowance} : null;
    } catch { return null; }
  }

  // ---- care-screen strip --------------------------------------------------

  let strip = null;
  function mount() {
    const care = document.getElementById('screen-care');
    if (!care || strip) return;
    strip = document.createElement('p');
    strip.id = 'robotCareStatus';
    strip.className = 'small robot-care-status';
    strip.setAttribute('role', 'status');
    care.insertBefore(strip, care.firstChild);
  }

  function show(text) {
    if (!text) return;
    mount();
    if (strip) strip.textContent = text;
  }

  async function refresh(nft) {
    mount();
    const pet = nft || active();
    if (!pet) { if (strip) strip.textContent = ''; return; }
    try {
      const data = await status(pet);
      if (!data) { show('Connect your wallet to see your ' + pet.name + ' balance.'); return; }
      const frens = frensLabel(data.balance, data.creditsPerFrens);
      const left = data.allowance?.remaining;
      const parts = [];
      if (frens) parts.push(frens);
      if (left != null) parts.push(left + ' free action' + (left === 1 ? '' : 's') + ' left today');
      show((pet.name || 'Your robot') + ': ' + (parts.join(' · ') || 'ready'));
    } catch { show(''); }
  }

  // Report a care action and surface the money result (non-blocking).
  async function after(action, state) {
    if (!active()) return;
    const result = await act(action);
    if (result.offline) { await refresh(); return; }
    if (result.blocked || result.requiresPayment) show(describe(result));
    else await refresh();
    if (state) window.dispatchEvent(new CustomEvent('tinyfrens-robot-care', {detail: {action, result}}));
  }

  // ---- wiring -------------------------------------------------------------

  window.addEventListener('tinyfrens-wallet-link-changed', () => refresh());
  window.addEventListener('tinyfrens-account-synced', () => refresh());
  window.addEventListener('tinyfrens-game-finished', event => { game(event?.detail?.game); });

  function init() {
    mount();
    if (active()) refresh();
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  window.TinyFrensRobotCare = {
    ROBOTS, key, isRobot, robots, active, setActive,
    status, act, game, balance, after, refresh, describe,
    fmtFrens, frensLabel, formatNumber,
  };
})();
