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
    button.textContent = 'Download Android APK ↗';
    document.getElementById('releaseStatus').textContent = `Latest: ${release.name || release.tag_name}`;
  } catch { /* The Releases link remains available without the API. */ }
})();
