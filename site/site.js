'use strict';
document.getElementById('copyFrensContract')?.addEventListener('click', async () => {
  const address = document.getElementById('frensContractAddress');
  const status = document.getElementById('frensContractStatus');
  try { await navigator.clipboard.writeText(address.textContent); status.textContent = 'Contract address copied'; }
  catch { status.textContent = 'Select the contract address above to copy it.'; }
});
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
