'use strict';
(async () => {
  try {
    const response = await fetch('https://api.github.com/repos/dutchiono/TinyFrens/releases/latest');
    if (!response.ok) return;
    const release = await response.json();
    const apk = release.assets?.find(a => a.name === 'pocket-familiar.apk');
    if (!apk) return;
    const url = new URL(apk.browser_download_url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/dutchiono/TinyFrens/releases/download/')) return;
    const button = document.getElementById('apk');
    button.href = url.href;
    button.textContent = 'Get Android app ↓';
    document.getElementById('releaseStatus').textContent = `Ready to download · ${release.name || release.tag_name}`;
  } catch { /* The Releases link remains available without the API. */ }
})();

(async () => {
  const image = document.getElementById('featuredArtwork');
  const status = document.getElementById('artworkStatus');
  if (!image || !status) return;
  try {
    const local = /^(localhost|127\.)/.test(location.hostname);
    const response = await fetch((local ? location.origin : 'https://tinyfrens.miono.live') + '/api/hood-turtles/preview?tokenId=1');
    if (!response.ok) throw new Error('Preview unavailable');
    const data = await response.json();
    if (!data.image?.startsWith('data:image/svg+xml;base64,') && !data.image?.startsWith('data:image/png;base64,')) throw new Error('Artwork unavailable');
    image.onload = () => { image.hidden = false; status.hidden = true; };
    image.onerror = () => { status.querySelector('p').textContent = 'The collection preview is unavailable. Connect your wallet to load your own turtle.'; };
    image.alt = data.name + ' · collection preview'; image.src = data.image;
    document.getElementById('featuredName').textContent = data.name;
  } catch { status.querySelector('p').textContent = 'The collection preview is unavailable. Connect your wallet to load your own turtle.'; }
})();
