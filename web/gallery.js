import { CONTRACT } from './robot-live.mjs';
import { OWNER_HANDLES, INITIAL_OWNERS } from './robot-owner-profiles.mjs';
const $ = id => document.getElementById(id);
const CACHE = `tinyfrens-gallery:8453:${CONTRACT}:v1`;
const endpoint = (window.TINYFRENS_SERVER || 'https://tinyfrens.miono.live') + '/api/robots/gallery';
let busy = false, snapshot = null, lastVisitCheck = 0;
function card({tokenId: id, metadata, owner, xHandle}) {
  owner = owner || INITIAL_OWNERS[id];
  xHandle = xHandle || OWNER_HANDLES[owner?.toLowerCase()];
  if (!metadata.image?.startsWith('data:image/svg+xml;base64,')) throw new Error(`Unexpected artwork format for #${id}`);
  const figure = document.createElement('figure'); figure.className = 'card';
  const image = document.createElement('img'); image.src = metadata.image; image.alt = metadata.name || `Robot #${id}`; image.loading = 'lazy';
  const caption = document.createElement('figcaption');
  const heading = document.createElement('a'); heading.className = 'robot-name'; heading.target = '_blank'; heading.rel = 'noopener noreferrer'; heading.href = `https://basescan.org/token/${CONTRACT}?a=${id}`; heading.textContent = `Robot #${id}`;
  const attributes = metadata.attributes || [];
  const statList = (values) => {
    const list = document.createElement('dl'); list.className = 'robot-stats';
    for (const trait of values) {
      const row = document.createElement('div');
      const label = document.createElement('dt'); label.textContent = trait.trait_type;
      const value = document.createElement('dd'); value.textContent = trait.value;
      row.append(label, value); list.append(row);
    }
    return list;
  };
  const primary = new Set(['Palette', 'Expression', 'Accessory', 'Habitat', 'Motion', 'Era', 'Rarity Tier']);
  caption.append(heading, statList(attributes.filter(t => primary.has(t.trait_type))));
  const ambient = attributes.filter(t => !primary.has(t.trait_type) && !['Series','Edition','Species'].includes(t.trait_type));
  caption.append(statList(ambient));
  const ownership = document.createElement('div'); ownership.className = 'robot-owner';
  const label = document.createElement('span'); label.textContent = 'OWNER';
  const wallet = document.createElement('a'); wallet.target = '_blank'; wallet.rel = 'noopener noreferrer'; wallet.textContent = 'Checking wallet…';
  ownership.append(label, wallet); caption.append(ownership);
  if (/^0x[a-fA-F0-9]{40}$/.test(owner || '')) {
    wallet.href = `https://basescan.org/address/${owner}`; wallet.title = owner;
    wallet.textContent = owner.slice(0,6) + '…' + owner.slice(-6);
  } else { wallet.textContent = 'Awaiting owner data'; }
  const social = document.createElement('div'); social.className = 'robot-owner';
  const socialLabel = document.createElement('span'); socialLabel.textContent = 'X';
  const handle = document.createElement('a'); handle.target = '_blank'; handle.rel = 'noopener noreferrer';
  if (/^[A-Za-z0-9_]{1,15}$/.test(xHandle || '')) { handle.href = `https://x.com/${xHandle}`; handle.textContent = '@' + xHandle; }
  else { handle.textContent = 'Handle unavailable'; }
  social.append(socialLabel, handle); caption.append(social);
  const market = document.createElement('a');
  market.className = 'robot-market';
  market.href = `https://opensea.io/assets/base/${CONTRACT}/${id}`;
  market.target = '_blank'; market.rel = 'noopener noreferrer';
  market.textContent = 'View on OpenSea ↗';
  caption.append(market);
  figure.append(image, caption); return figure;
}

function render(cached = false) {
  $('gallery').replaceChildren(...snapshot.items.map(card));
  $('status').textContent = (snapshot.supply ? `${snapshot.supply.toLocaleString()} robots minted · Showing ${snapshot.items.length}` : 'No robots minted yet. The gallery will fill as people mint.') +
    (cached || snapshot.stale ? ' · Saved gallery; waiting for a live refresh.' : '');
  $('more').hidden = snapshot.nextAfter === null;
}
async function load(more = false, quiet = false, force = false) {
  if (busy) return;
  busy = true; lastVisitCheck = Date.now(); $('more').disabled = true;
  try {
    const after = more ? snapshot?.nextAfter : 0;
    if (after === null) return;
    const response = await fetch(`${endpoint}?after=${after}${force ? "&refresh=1" : ""}`, {cache: force ? "no-store" : "default", signal: AbortSignal.timeout(45000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Gallery unavailable');
    if (data.contract !== CONTRACT || data.chainId !== 8453 || !Array.isArray(data.items)) throw new Error('Unexpected gallery response');
    // Preserve known owners when an older API revision omits the field.
    for (const item of data.items) {
      const previous = snapshot?.items.find(saved => saved.tokenId === item.tokenId);
      if (!Object.hasOwn(item, 'owner') && previous?.owner) item.owner = previous.owner;
    }
    // An unchanged inventory needs no DOM reset, preserving the animated SVG playback.
    if (quiet && !data.stale && snapshot && data.supply === snapshot.supply &&
        JSON.stringify(data.items.map(item => item.tokenId)) === JSON.stringify(snapshot.items.slice(0,24).map(item => item.tokenId))) {
      snapshot.checkedAt = data.checkedAt; snapshot.stale = false;
      $('status').textContent = snapshot.supply ? `${snapshot.supply.toLocaleString()} robots minted · Showing ${snapshot.items.length}` : 'No robots minted yet. The gallery will fill as people mint.';
    } else {
      snapshot = {...data, items: more ? [...snapshot.items, ...data.items] : data.items};
      render();
    }
    try { localStorage.setItem(CACHE, JSON.stringify(snapshot)); } catch { /* Storage quota must not block the gallery. */ }
  } catch (error) {
    if (snapshot) render(true);
    $('status').textContent = (snapshot ? 'Showing saved artwork. ' : '') + `Could not refresh the gallery: ${error.message}`;
  } finally { busy = false; $('more').disabled = false; }
}
$('more').addEventListener('click', () => load(true));
async function copyMintMessage() {
  const message = $('mint-message');
  try { await navigator.clipboard.writeText(message.textContent); $('copy-status').textContent = 'Copied'; }
  catch {
    const range = document.createRange(); range.selectNodeContents(message);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    $('copy-status').textContent = 'Message selected. Copy it to send to Bankr.';
  }
}
$('mint-message').addEventListener('click', copyMintMessage);
$('mint-message').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); copyMintMessage(); }
});

try {
  const saved = JSON.parse(localStorage.getItem(CACHE));
  if (saved?.contract === CONTRACT && saved.chainId === 8453 && Array.isArray(saved.items)) { snapshot = saved; render(true); }
} catch { /* Ignore unavailable storage or an old invalid snapshot. */ }
load();
function checkIfDue() { if (!document.hidden && Date.now() - lastVisitCheck >= 600000) load(false, true); }
setInterval(checkIfDue, 600000);
document.addEventListener('visibilitychange', checkIfDue);
