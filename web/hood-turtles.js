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
  if (!result.companion) { message('This turtle’s artwork needs a supported animation rig before it can join your space.'); return; }
  latest = result; $('art').src = result.companion?.idle || result.image; $('art').alt = result.name; $('art').hidden = false; $('load').disabled = false;
  message('Your turtle companion is ready. Ownership renews every 24 hours.');
}
async function loadLinkedWallet() {
  const result = await post('/api/wallet-link/status');
  const addresses = result.addresses || (result.address ? [result.address] : []);
  $('wallet').textContent = addresses.length ? `${addresses.length} wallet${addresses.length === 1 ? '' : 's'} connected` : 'No wallet connected yet.';
  $('check').disabled = !addresses.length;
  if (!addresses.length) return;
  $('turtlePanel').hidden = false;

  message('Finding supported NFTs across your wallets…');
  const holdings = await post('/api/wallet-link/nfts');
  $('turtleChoices').replaceChildren();
  if ($('tokenId').value && holdings.nfts.some(nft => nft.tokenId === Number($('tokenId').value))) await check();
  if (holdings.nfts.length === 1) { $('tokenId').value = holdings.nfts[0].tokenId; await check(); return; }
  message(holdings.nfts.length ? 'Choose an NFT to import.' : 'No supported NFTs found in your linked wallets.');
  for (const nft of holdings.nfts) {
    const button = document.createElement('button'); button.textContent = nft.name;
    button.onclick = () => { $('tokenId').value = nft.tokenId; check().catch(error => message(error)); };
    $('turtleChoices').append(button);
  }
}
$('check').addEventListener('click', () => check().catch(error => message(error)));
$('tokenId').addEventListener('input', clearPreview);
async function importTurtle() {
  try {
    if (!latest?.active || latest.tokenId !== tokenId() || Date.now() >= latest.validUntil * 1000) return;
    $('load').disabled = true;
    if (window.PetAndroid?.turtleRequest || window.TinyFrensDesktop?.turtleRequest) await post('/native/import-turtle', {tokenId: latest.tokenId});
    const selected = JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]').filter(nft => nft.tokenId !== latest.tokenId);
    if (selected.length >= 5) throw new Error('You can show up to five companions. Remove one from your space first.');
    selected.push(latest);
    localStorage.setItem('tinyfrens-companions', JSON.stringify(selected));
    localStorage.setItem(storageKey, JSON.stringify(latest));
    location.href = './index.html#pet';
  } catch (error) { message(error); $('load').disabled = false; }
}
$('load').addEventListener('click', importTurtle);
$('connectWallet').addEventListener('click', async () => {
  $('connectWallet').disabled = true;
  try {
    await ensureIdentity();
    if (!window.ethereum?.request) throw new Error('Open this page in your wallet’s browser to connect, or use Bankr above.');
    const accounts = await window.ethereum.request({method: 'eth_requestAccounts'});
    if (!accounts?.[0]) throw new Error('No wallet selected.');
    const challenge = await post('/api/wallet-link/challenge', {address: accounts[0]});
    message('Review and sign the TinyFrens connection message. No transaction or gas.', $('connectionStatus'));
    const signature = await window.ethereum.request({method: 'personal_sign', params: [challenge.message, accounts[0]]});
    await post('/api/wallet-link/confirm', {signature});
    message('Wallet connected to this device.', $('connectionStatus')); await loadLinkedWallet();
  } catch (error) { message(error, $('connectionStatus')); }
  finally { $('connectWallet').disabled = false; }
});
async function pollPairing() {
  clearTimeout(pollTimer);
  if (!pairing || document.hidden) return;
  if (Date.now() >= pairing.expires * 1000) {
    $('acceptPairing').hidden = true; message('This code expired. Tap Generate new code for a new one.', $('pairingStatus')); pairing = null; return;
  }
  if (busy) return;
  busy = true; const current = pairing;
  try {
    const result = await post('/api/turtle-connect/status', {code: current.code});
    if (pairing !== current) return;
    $('acceptPairing').hidden = !result.verified;
    message(result.verified ? `Bankr verified wallet ${result.wallet}. Accept only if this is yours.` : 'Waiting for Bankr to sign your connection message…', $('pairingStatus'));
  } catch (error) { if (pairing === current) { $('acceptPairing').hidden = true; message(error, $('pairingStatus')); } }
  finally { busy = false; if (pairing && !document.hidden) pollTimer = setTimeout(pollPairing, 4000); }
}
async function startPairing() {
  $('connectBankr').disabled = true; pairing = null; clearTimeout(pollTimer); $('acceptPairing').hidden = true;
  try {
    message('Creating your connection code…', $('connectionStatus'));
    await ensureIdentity();
    pairing = await post('/api/turtle-connect/start'); $('pairing').hidden = false;
    $('connectBankr').textContent = 'Generate new code';
    $('pairingCode').textContent = pairing.code.match(/.{1,4}/g).join('-');
    $('bankrPrompt').value = `Hey @bankrbot use the skill at https://tinyfrens.lol/import/skill.md to link my wallet to TinyFrens and find my supported NFTs. My connect code is ${$('pairingCode').textContent}. Keep my NFTs in my wallet.`;
    message('Send this prompt to @bankrbot on X or to your Bankr agent. Return here to accept your wallet link and choose companions.', $('connectionStatus')); await pollPairing();
  } catch (error) { message(error, $('connectionStatus')); }
  finally { $('connectBankr').disabled = false; $('connectBankr').hidden = false; }
}
$('connectBankr').addEventListener('click', startPairing);
$('copyPrompt').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('bankrPrompt').value); message('Tweet copied. Paste it into X and post to @bankrbot.', $('pairingStatus')); }
  catch { $('bankrPrompt').focus(); $('bankrPrompt').select(); message('Select and copy the prompt above.', $('pairingStatus')); }
});
$('acceptPairing').addEventListener('click', async () => {
  if (!pairing) return; $('acceptPairing').disabled = true;
  try {
    const result = await post('/api/turtle-connect/accept', {code: pairing.code});
    pairing = null; clearTimeout(pollTimer); $('pairing').hidden = true;
    $('connectBankr').textContent = 'Generate code';
    $('tokenId').value = result.tokenId || '';
    message('Your Bankr wallet is connected to this device.', $('connectionStatus')); await loadLinkedWallet();
    if (latest?.active) await importTurtle();
  } catch (error) { message(error, $('pairingStatus')); }
  finally { $('acceptPairing').disabled = false; }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollPairing(); });
let initializing;
async function ensureIdentity() {
  if (identity?.token) return;
  if (initializing) return initializing;
  initializing = initIdentity();
  try { await initializing; } finally { initializing = null; }
}
async function initIdentity() {
  const requested = new URLSearchParams(location.search).get('tokenId');
  if (requested && /^\d+$/.test(requested)) $('tokenId').value = requested;
  const key = 'tinyfrens-device:' + apiBase;
  try { identity = JSON.parse(localStorage.getItem(key) || 'null'); } catch { identity = null; }
  if (!identity?.token) {
    identity = await post('/api/register', {pet: {name: 'My turtle', shape: 'turtle', color: '#82eba1'}});
    localStorage.setItem(key, JSON.stringify(identity));
  }
}
ensureIdentity().then(async () => {
  try { await loadLinkedWallet(); } catch (error) { message(error); }
}).catch(error => {
  $('connectBankr').hidden = false;
  message('Could not prepare your device. Tap Generate code to retry. ' + error.message, $('connectionStatus'));
});
