/* Robots v1 account-Energy client.
 *
 * The server verifies fresh ownership plus the complete account Robot inventory.
 * Robot care is fail-closed; other companion collections retain their local loop.
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

  function isRobot(nft) {
    if (!nft || nft.chainId !== ROBOTS.chainId) return false;
    if (String(nft.originalAddress || '').toLowerCase() !== ROBOTS.contract) return false;
    return nft.companion?.adapter ? nft.companion.adapter === ROBOTS.adapter : true;
  }

  function robots() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]'); } catch { saved = []; }
    return (Array.isArray(saved) ? saved : []).filter(nft => isRobot(nft) && nft.active !== false);
  }

  function active() {
    const all = robots();
    if (!all.length) return null;
    if (all.length === 1) return all[0];
    let chosen = null;
    try { chosen = localStorage.getItem(CHOICE_KEY); } catch {}
    return all.find(nft => key(nft) === chosen) || all[0];
  }

  function setActive(nft) {
    if (!nft) return;
    try { localStorage.setItem(CHOICE_KEY, key(nft)); } catch {}
  }

  async function post(path, body) {
    const device = identity();
    if (!device) throw new Error('Connect your wallet to care for your robot.');
    const data = await window.TinyFrensTurtleAPI(base(), path, {token: device.token, ...body});
    if (data.energy) window.dispatchEvent(new Event('tinyfrens-energy-updated'));
    return data;
  }

  function formatNumber(value) {
    const text = String(Math.round(value * 100) / 100);
    const [whole, fraction] = text.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return fraction ? grouped + '.' + fraction : grouped;
  }

  function fmtEnergy(milli) {
    return milli == null ? null : formatNumber(Number(milli) / 1000);
  }

  function energyLabel(milli) {
    const amount = fmtEnergy(milli);
    return amount == null ? null : amount + ' Energy';
  }

  function describe(result) {
    if (!result) return '';
    if (result.blocked) return result.message || 'Care is unavailable right now.';
    const cost = energyLabel(result.costMilli);
    const remaining = energyLabel(result.energy?.totalMilli);
    if (result.insufficientEnergy) {
      return 'Not enough Energy' + (cost ? ' — this needs ' + cost : '') + (remaining ? ' and you have ' + remaining : '') + '.';
    }
    if (result.allowed) {
      return (cost ? 'Used ' + cost : 'Done') + (remaining ? ' · ' + remaining + ' remaining.' : '.');
    }
    return 'Care is unavailable right now.';
  }

  async function status(nft) {
    const pet = nft || active();
    if (!pet || !identity()) return null;
    return post('/api/robots/care', {tokenId: pet.tokenId});
  }

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
      return data ? data.energy : null;
    } catch { return null; }
  }

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
    mount(); updatePicker();
    const pet = nft || active();
    if (!pet) { if (strip) strip.textContent = ''; return; }
    try {
      const data = await status(pet);
      if (!data) { show('Connect your wallet to see account Energy.'); return; }
      const energy = energyLabel(data.energy?.totalMilli);
      const rate = energyLabel(data.energy?.ratePerDayMilli);
      const robotsCount = Number(data.energy?.eligibleRobots || 0);
      show((energy || '0 Energy') + (rate ? ' · +' + rate + '/day' : '') + ' · ' + robotsCount + ' Robot' + (robotsCount === 1 ? '' : 's'));
    } catch { show('Robot Energy is temporarily unavailable.'); }
  }

  async function before(action) {
    const pet = active();
    if (!pet) return true;
    const result = await act(action, pet);
    if (result.offline) {
      show('Connect to the internet before using Robot care.');
      return false;
    }
    show(describe(result));
    return result.allowed === true;
  }

  async function beforeGame() {
    if (!active()) {
      show('A verified Robot is required to play.');
      return false;
    }
    return before('play');
  }

  async function after(action, state) {
    if (state) window.dispatchEvent(new CustomEvent('tinyfrens-robot-care', {detail: {action, result: null}}));
    await refresh();
  }

  let picker;
  function mountPicker() {
    const care = document.getElementById('screen-care');
    if (!care || picker) return;
    const label = document.createElement('label'); label.textContent = 'Care for';
    picker = document.createElement('select'); picker.id = 'careRobotPicker'; label.htmlFor = picker.id;
    picker.onchange = () => {
      const pet = robots().find(nft => key(nft) === picker.value);
      if (pet) { setActive(pet); refresh(pet); }
    };
    const row = document.createElement('div'); row.className = 'care-robot-picker'; row.append(label, picker); care.prepend(row);
  }

  function updatePicker() {
    mountPicker();
    if (!picker) return;
    const all = robots(); picker.replaceChildren();
    for (const pet of all) {
      const option = document.createElement('option');
      option.value = key(pet); option.textContent = pet.name || 'Robot #' + pet.tokenId; picker.append(option);
    }
    picker.value = active() ? key(active()) : '';
    picker.parentElement.hidden = all.length < 2;
  }

  window.addEventListener('tinyfrens-wallet-link-changed', () => refresh());
  window.addEventListener('tinyfrens-account-synced', () => refresh());

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
    status, act, game, balance, before, beforeGame, after, refresh, describe,
    fmtEnergy, energyLabel, formatNumber,
  };
})();
