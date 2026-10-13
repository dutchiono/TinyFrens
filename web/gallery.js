import { CONTRACT, rpc, decodeString, decodeMetadata } from './robot-live.mjs';
const $ = id => document.getElementById(id);
let nextId = 1, supply = 0, shown = 0, busy = false;
const call = (data, block) => rpc('eth_call', [{to:CONTRACT,data}, block]);
function card(id, metadata) {
  if (!metadata.image?.startsWith('data:image/svg+xml;base64,')) throw new Error(`Unexpected artwork format for #${id}`);
  const figure = document.createElement('figure'); figure.className = 'card';
  const image = document.createElement('img'); image.src = metadata.image; image.alt = metadata.name || `Robot #${id}`; image.loading = 'lazy';
  const caption = document.createElement('figcaption');
  const link = document.createElement('a'); link.href = `https://basescan.org/token/${CONTRACT}?a=${id}`; link.textContent = metadata.name || `Robot #${id}`;
  const traits = document.createElement('p'); traits.className = 'traits'; traits.textContent = (metadata.attributes || []).map(t => `${t.trait_type}: ${t.value}`).join(' · ');
  caption.append(link, traits); figure.append(image, caption); return figure;
}
async function load(reset = false, quiet = false) {
  if (busy) return;
  busy = true; $('refresh').disabled = true; $('more').disabled = true;
  try {
    if (await rpc('eth_chainId', []) !== '0x2105') throw new Error('RPC is not connected to Base');
    const block = await rpc('eth_blockNumber', []);
    const latestSupply = Number(BigInt(await call('0x18160ddd', block)));
    if (quiet && latestSupply === supply && shown > 0) return;
    if (reset) { nextId = 1; shown = 0; $('gallery').replaceChildren(); }
    supply = latestSupply;
    const target = Math.min(shown + 24, supply);
    // Supply is a count, not the highest ID. Skip burned IDs, never RPC failures.
    while (shown < target && nextId <= 2664) {
      const id = nextId;
      const encoded = await call('0xc87b56dd' + BigInt(id).toString(16).padStart(64, '0'), block);
      if (encoded !== null) { $('gallery').append(card(id, decodeMetadata(decodeString(encoded)))); shown++; }
      nextId++;
    }
    if (shown < target) throw new Error('Minted token count does not match the collection');
    $('status').textContent = supply ? `${supply.toLocaleString()} robots minted · Showing ${shown}` : 'No robots minted yet. The gallery will fill as people mint.';
    $('more').hidden = shown >= supply;
  } catch (error) { $('status').textContent = `Could not load the live gallery: ${error.message}. Please try Refresh gallery.`; }
  finally { busy = false; $('refresh').disabled = false; $('more').disabled = false; }
}
$('refresh').addEventListener('click', () => load(true));
$('more').addEventListener('click', () => load());
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('mint-message').value); $('copy-status').textContent = ' Copied'; }
  catch { $('mint-message').focus(); $('mint-message').select(); $('copy-status').textContent = ' Select and copy the message above.'; }
});
load(true);
setInterval(() => { if (!document.hidden) load(true, true); }, 60000);
