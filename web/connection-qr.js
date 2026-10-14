(() => {
  'use strict';
  function parse(value) {
    const url = new URL(value);
    if (!['https:'].includes(url.protocol) || !['tinyfrens.lol', 'www.tinyfrens.lol'].includes(url.hostname) || !['/web/', '/web/index.html'].includes(url.pathname)) throw Error('Scan a TinyFrens connection QR code.');
    const query = new URLSearchParams(url.search), hash = new URLSearchParams(url.hash.slice(1));
    const kind = query.has('sync-device') ? 'sync-device' : 'connect-device';
    const code = query.get(kind) || hash.get(kind) || '';
    if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) throw Error('This QR code does not contain a valid connection code.');
    return {kind, code, url:url.href};
  }
  function render(host, url) {
    host.replaceChildren();
    if (!url) return;
    parse(url);
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    host.innerHTML = qr.createSvgTag({cellSize:4, margin:16, scalable:true});
    host.querySelector('svg').setAttribute('aria-label', 'Scan to connect to TinyFrens');
  }
  async function scan() {
    const dialog = document.createElement('dialog'); dialog.className = 'connection-scanner';
    dialog.innerHTML = '<h2>Scan a TinyFrens code</h2><video autoplay muted playsinline></video><p role="status">Point your camera at a device or wallet connection QR.</p><button type="button">Cancel</button>';
    document.body.append(dialog); dialog.showModal();
    const video = dialog.querySelector('video'), status = dialog.querySelector('p');
    let stream, timer, done = false;
    return new Promise((resolve, reject) => {
      function finish(result, error) {
        if (done) return; done = true; clearTimeout(timer);
        document.removeEventListener('visibilitychange', stopHidden);
        stream?.getTracks().forEach(track => track.stop()); dialog.remove();
        error ? reject(error) : resolve(result);
      }
      dialog.querySelector('button').onclick = () => finish(null);
      dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
      dialog.addEventListener('close', () => finish(null));
      const stopHidden = () => { if (document.hidden) finish(null); };
      document.addEventListener('visibilitychange', stopHidden);
      dialog.addEventListener('close', () => document.removeEventListener('visibilitychange', stopHidden), {once:true});
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', {willReadFrequently:true});
      async function start() {
        try {
          if (window.PetAndroid || window.PetIOS) throw Error('Scan with your phone’s Camera app, then open the connection in TinyFrens, or enter the displayed code.');
          if (!navigator.mediaDevices?.getUserMedia) throw Error('Use your phone’s Camera app to scan this QR, or enter the displayed code.');
          stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}, audio:false});
          if (done) { stream.getTracks().forEach(track => track.stop()); return; }
          video.srcObject = stream; await video.play();
          function frame() {
            if (done) return;
            if (video.readyState >= 2) {
              canvas.width = Math.min(video.videoWidth, 800); canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const qr = jsQR(image.data, image.width, image.height);
              if (qr) { try { finish(parse(qr.data)); return; } catch (error) { status.textContent = error.message; } }
            }
            timer = setTimeout(frame, 150);
          }
          frame();
        } catch (error) { finish(null, error); }
      }
      start();
    });
  }
  window.TinyFrensQR = {parse, render, scan};
})();
