const storageKey = 'tinyfrens-hood-turtle';
const $ = id => document.getElementById(id);
const apiBase = String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
let identity, latest, pairing, pollTimer, busy = false;
function message(value, target = $('status')) { target.textContent = value instanceof Error ? value.message : String(value); }
async function post(path, body = {}) {
  return window.TinyFrensTurtleAPI(apiBase, path, {token: identity?.token, ...body});
}
function tokenId() {
  const value = Number($('tokenId').value);
  if (!Number.isInteger(value) || value < 1 || value > 2222) throw new Error('Enter a token number from 1 to 2222.');
  return value;
}
function clearPreview() { latest = null; $('load').disabled = true; $('art').hidden = true; $('art').removeAttribute('src'); }
async function check() {
  clearPreview(); const requested = tokenId();
  const result = await post('/api/featured/hood-turtle', {tokenId: requested});
  if (requested !== tokenId()) return;
  if (!result.active) { message('The connected wallet does not currently own that Hood Turtle.'); return; }
  if (!result.image?.startsWith('data:image/svg+xml;base64,') && !result.image?.startsWith('data:image/png;base64,')) {
    message('Ownership verified, but the original artwork could not be loaded.'); return;
  }
  latest = result; $('art').src = result.image; $('art').alt = result.name; $('art').hidden = false; $('load').disabled = false;
  message('Your original turtle is ready. Ownership renews every 24 hours.');
}
async function loadLinkedWallet() {
  const result = await post('/api/wallet-link/status');
  $('wallet').textContent = result.address ? `Connected: ${result.address}` : 'No wallet connected yet.';
  $('check').disabled = !result.address;
  if (result.address) await check();
}
$('check').addEventListener('click', () => check().catch(error => message(error)));
$('tokenId').addEventListener('input', clearPreview);
$('load').addEventListener('click', async () => {
  try {
    if (!latest?.active || latest.tokenId !== tokenId() || Date.now() >= latest.validUntil * 1000) return;
    $('load').disabled = true;
    if (window.PetAndroid?.turtleRequest || window.TinyFrensDesktop?.turtleRequest) await post('/native/import-turtle', {tokenId: latest.tokenId});
    localStorage.setItem(storageKey, JSON.stringify({tokenId: latest.tokenId, image: latest.image, name: latest.name, validUntil: latest.validUntil}));
    location.href = './index.html#pet';
  } catch (error) { message(error); $('load').disabled = false; }
});
$('connectWallet').addEventListener('click', async () => {
  $('connectWallet').disabled = true;
  try {
    if (!window.ethereum?.request) throw new Error('Open this page in your wallet’s browser to connect, or use Bankr above.');
    const accounts = await window.ethereum.request({method: 'eth_requestAccounts'});
    if (!accounts?.[0]) throw new Error('No wallet selected.');
    const challenge = await post('/api/wallet-link/challenge', {address: accounts[0]});
    message('Review and sign the TinyFrens connection message. No transaction or gas.', $('connectionStatus'));
    const signature = await window.ethereum.request({method: 'personal_sign', params: [challenge.message, accounts[0]]});
    await post('/api/wallet-link/confirm', {signature});
    window.clearImportedTurtle?.();
    message('Wallet connected to this device.', $('connectionStatus')); await loadLinkedWallet();
  } catch (error) { message(error, $('connectionStatus')); }
  finally { $('connectWallet').disabled = false; }
});
async function pollPairing() {
  clearTimeout(pollTimer);
  if (!pairing || document.hidden) return;
  if (Date.now() >= pairing.expires * 1000) {
    $('acceptPairing').hidden = true; message('This code expired. Tap Connect with Bankr for a new one.', $('pairingStatus')); pairing = null; return;
  }
  if (busy) return;
  busy = true; const current = pairing;
  try {
    const result = await post('/api/turtle-connect/status', {code: current.code});
    if (pairing !== current) return;
    $('acceptPairing').hidden = !result.verified;
    message(result.verified ? `Bankr verified ${result.wallet} and Hood Turtle #${result.tokenId}. Accept only if these are yours.` : 'Waiting for Bankr to sign your connection message…', $('pairingStatus'));
  } catch (error) { if (pairing === current) { $('acceptPairing').hidden = true; message(error, $('pairingStatus')); } }
  finally { busy = false; if (pairing && !document.hidden) pollTimer = setTimeout(pollPairing, 4000); }
}
$('connectBankr').addEventListener('click', async () => {
  $('connectBankr').disabled = true; pairing = null; clearTimeout(pollTimer); $('acceptPairing').hidden = true;
  try {
    pairing = await post('/api/turtle-connect/start'); $('pairing').hidden = false;
    $('pairingCode').textContent = pairing.code.match(/.{1,4}/g).join('-');
    $('bankrPrompt').value = `Install the TinyFrens connection skill at https://github.com/dutchiono/TinyFrens/tree/main/skills/tinyfrens-connect if needed. Use it to connect my Hood Turtle to the waiting TinyFrens device with pairing code ${pairing.code}. Ask me which turtle if I own several. Sign only the read-only TinyFrens pairing message; do not transfer anything.`;
    message('Give this code only to your own Bankr agent. You will accept the verified wallet here.', $('connectionStatus')); await pollPairing();
  } catch (error) { message(error, $('connectionStatus')); }
  finally { $('connectBankr').disabled = false; }
});
$('copyPrompt').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('bankrPrompt').value); message('Prompt copied.', $('pairingStatus')); }
  catch { $('bankrPrompt').focus(); $('bankrPrompt').select(); message('Select and copy the prompt above.', $('pairingStatus')); }
});
$('acceptPairing').addEventListener('click', async () => {
  if (!pairing) return; $('acceptPairing').disabled = true;
  try {
    const result = await post('/api/turtle-connect/accept', {code: pairing.code});
    pairing = null; clearTimeout(pollTimer); $('pairing').hidden = true; $('tokenId').value = result.tokenId;
    window.clearImportedTurtle?.();
    message('Your Bankr wallet is connected to this device.', $('connectionStatus')); await loadLinkedWallet();
  } catch (error) { message(error, $('pairingStatus')); }
  finally { $('acceptPairing').disabled = false; }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollPairing(); });
async function init() {
  const requested = new URLSearchParams(location.search).get('tokenId');
  if (requested && /^\d+$/.test(requested)) $('tokenId').value = requested;
  const key = 'tinyfrens-device:' + apiBase;
  try { identity = JSON.parse(localStorage.getItem(key) || 'null'); } catch { identity = null; }
  if (!identity?.token) {
    identity = await post('/api/register', {pet: {name: 'My turtle', shape: 'turtle', color: '#82eba1'}});
    localStorage.setItem(key, JSON.stringify(identity));
  }
  $('connectBankr').disabled = false; $('connectWallet').disabled = false;
  message('Choose Bankr or your wallet to connect.', $('connectionStatus')); await loadLinkedWallet();
}
init().catch(error => message(error, $('connectionStatus')));
