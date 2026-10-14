const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '../web');
const listeners = new Map();
const context = {
  URL, URLSearchParams, Event, CustomEvent, console,
  window: {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); },
  },
};
const wallets = ['MetaMask','Rainbow','Rabby','Phantom'].map(name => ({
  info:{uuid:name,name}, provider:{request:() => name},
}));
context.window.ethereum = wallets[1].provider;
context.window.addEventListener('eip6963:requestProvider', () => {
  for (const detail of wallets) context.window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {detail}));
});
vm.createContext(context);
for (const file of ['wallet-providers.js','vendor/qrcode.js','vendor/jsQR.js','connection-qr.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const providers = context.window.TinyFrensWalletProviders.discover();
assert.deepEqual([...providers.values()].map(item=>item.name), wallets.map(item=>item.info.name));
assert.equal(providers.size, 4, 'legacy provider must not duplicate an announced wallet');
assert.equal(providers.get('Rabby').provider.request(), 'Rabby');
assert.equal(context.window.TinyFrensWalletProviders.discover().size, 4, 'reannouncements deduplicate');
for (const kind of ['sync-device','connect-device']) {
  const url = 'https://www.tinyfrens.lol/web/?' + kind + '=ABCDEFGHJKLM#account';
  assert.equal(context.window.TinyFrensQR.parse(url).kind, kind);
  const qr = context.qrcode(0, 'M'); qr.addData(url); qr.make();
  const size = qr.getModuleCount(), scale = 6, margin = 4, width = (size + margin * 2) * scale;
  const rgba = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y=0;y<width;y++) for (let x=0;x<width;x++) {
    const row = Math.floor(y/scale)-margin, col = Math.floor(x/scale)-margin;
    if (row>=0 && col>=0 && row<size && col<size && qr.isDark(row,col)) {
      const index=(y*width+x)*4; rgba[index]=rgba[index+1]=rgba[index+2]=0;
    }
  }
  assert.equal(context.jsQR(rgba,width,width).data, url, 'QR encoder must round-trip through scanner');
}
for (const bad of ['https://evil.test/web/?sync-device=ABCDEFGHJKLM','https://www.tinyfrens.lol/web/?sync-device=not-valid','javascript:alert(1)']) {
  assert.throws(()=>context.window.TinyFrensQR.parse(bad));
}
console.log('Connection checks passed: four providers, deduplication, QR encode/decode and URL validation');
