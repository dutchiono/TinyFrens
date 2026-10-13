import { CONTRACT } from './robot-live.mjs';
const $ = id => document.getElementById(id);
const CACHE = `tinyfrens-gallery:8453:${CONTRACT}:v1`;
const endpoint = (window.TINYFRENS_SERVER || 'https://tinyfrens.miono.live') + '/api/robots/gallery';
let busy = false, snapshot = null;
function card({tokenId: id, metadata}) {
  if (!metadata.image?.startsWith('data:image/svg+xml;base64,')) throw new Error(`Unexpected artwork format for #${id}`);
  const figure = document.createElement('figure'); figure.className = 'card';
  const image = document.createElement('img'); image.src = metadata.image; image.alt = metadata.name || `Robot #${id}`; image.loading = 'lazy';
  const caption = document.createElement('figcaption');
  const link = document.createElement('a'); link.href = `https://basescan.org/token/${CONTRACT}?a=${id}`; link.textContent = metadata.name || `Robot #${id}`;
  const traits = document.createElement('p'); traits.className = 'traits'; traits.textContent = (metadata.attributes || []).map(t => `${t.trait_type}: ${t.value}`).join(' · ');
  caption.append(link, traits); figure.append(image, caption); return figure;
}
function render(cached = false) {
  $('gallery').replaceChildren(...snapshot.items.map(card));
  $('status').textContent = (snapshot.supply ? `${snapshot.supply.toLocaleString()} robots minted · Showing ${snapshot.items.length}` : 'No robots minted yet. The gallery will fill as people mint.') +
    (cached || snapshot.stale ? ' · Saved gallery; waiting for a live refresh.' : '');
  $('more').hidden = snapshot.nextAfter === null;
}
async function load(more = false, quiet = false, force = false) {
  if (busy) return;
  busy = true; $('refresh').disabled = true; $('more').disabled = true;
  try {
    const after = more ? snapshot?.nextAfter : 0;
    if (after === null) return;
    const response = await fetch(`${endpoint}?after=${after}${force ? "&refresh=1" : ""}`, {cache: force ? "no-store" : "default", signal: AbortSignal.timeout(45000)});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Gallery unavailable');
    if (data.contract !== CONTRACT || data.chainId !== 8453 || !Array.isArray(data.items)) throw new Error('Unexpected gallery response');
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
  } finally { busy = false; $('refresh').disabled = false; $('more').disabled = false; }
}
$('refresh').addEventListener('click', () => load(false, false, true));
$('more').addEventListener('click', () => load(true));
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('mint-message').value); $('copy-status').textContent = ' Copied'; }
  catch { $('mint-message').focus(); $('mint-message').select(); $('copy-status').textContent = ' Select and copy the message above.'; }
});
try {
  const saved = JSON.parse(localStorage.getItem(CACHE));
  if (saved?.contract === CONTRACT && saved.chainId === 8453 && Array.isArray(saved.items)) { snapshot = saved; render(true); }
} catch { /* Ignore unavailable storage or an old invalid snapshot. */ }
load();
setInterval(() => { if (!document.hidden) load(false, true); }, 60000);
