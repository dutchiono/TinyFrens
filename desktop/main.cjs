'use strict';
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, session, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PetStore } = require('./state.cjs');
const { TurtleStore, SERVER } = require('./turtle.cjs');
const { clampPosition, hits } = require('./geometry.cjs');
const WIDTH = 340, HEIGHT = 400;
const RELEASES = 'https://github.com/dutchiono/TinyFrens/releases/tag/desktop-latest';
const smoke = process.argv.includes('--tinyfrens-smoke') || app.commandLine.hasSwitch('tinyfrens-smoke');
// Seamless self-update: Windows installer builds download and install in the background.
// Unpacked dev runs, macOS (unsigned builds cannot self-update) and smoke tests keep the manual flow.
const autoUpdate = process.platform === 'win32' && app.isPackaged && !smoke;
// Intel macOS CI runners expose no usable GPU; use software rendering for the test only.
if (smoke && process.platform === 'darwin' && process.arch === 'x64') app.disableHardwareAcceleration();
if (smoke) console.log('Starting isolated desktop smoke test.');
if (smoke) setTimeout(() => { console.error('Desktop startup/renderer test did not finish within 45 seconds'); finishSmoke(1); }, 45000);
if (smoke) app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tinyfrens-smoke-')));
let store, turtles, turtleTick, pet, careWindow, tray, tick, quitting = false, petVisible = false, regions = [], menuUntil = 0, drag = null;
let moving = null, target = null, nextTarget = 0, lastTick = Date.now(), ignoring = true, sleepingUntil = 0, fadeTimer = null, systemReducedMotion = false;
const allowedWindows = new Map();
function pageURL(url) { try { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; } catch { return ''; } }
function trusted(event) {
  const expected = allowedWindows.get(event.sender.id);
  return !!expected && event.senderFrame === event.sender.mainFrame && expected.has(pageURL(event.senderFrame.url));
}
function external(url) {
  try { const u = new URL(url); if ((u.protocol === 'https:' && ['github.com', 'bankr.bot', 'dutchiono.github.io', 'tinyfrens.lol', 'www.tinyfrens.lol', 't.me', 'x.com'].includes(u.hostname) && !u.username && !u.password) || url === 'mailto:Tinyfrens@agentmail.to') shell.openExternal(url); } catch {}
}
function secureWindow(win, file) {
  const expected = pathToFileURL(file).href;
  const pages = new Set([expected]);
  if (file === path.join(__dirname, 'web/index.html')) pages.add(pathToFileURL(path.join(__dirname, 'web/hood-turtles.html')).href);
  allowedWindows.set(win.webContents.id, pages);
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { if (!pages.has(pageURL(url))) { event.preventDefault(); external(url); } });
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  const id = win.webContents.id;
  win.on('closed', () => allowedWindows.delete(id));
  return win.loadFile(file);
}
const preferences = () => ({ preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false });
function snapshot(extra = {}) { return { ...store.read(), visible: petVisible, autoUpdate, frameless: process.platform === 'win32', ...extra }; }
function broadcast(extra = {}) {
  const data = snapshot(extra);
  for (const win of [pet, careWindow]) if (win && !win.isDestroyed()) win.webContents.send('tinyfrens:state', data);
  updateTray();
  return data;
}
function animate(action) { for (const win of [pet, careWindow]) if (win && !win.isDestroyed()) win.webContents.send('tinyfrens:animation', action); }
function broadcastTurtle() { for (const win of [pet, careWindow]) if (win && !win.isDestroyed()) win.webContents.send('tinyfrens:turtle', turtles.view()); }
function recover() {
  const area = screen.getPrimaryDisplay().workArea;
  const point = clampPosition({ x: area.x + area.width - WIDTH - 30, y: area.y + area.height - HEIGHT - 30 }, area, WIDTH, HEIGHT);
  pet.setPosition(point.x, point.y); moving = point; target = null; nextTarget = 0;
}
function fadeWindow(from, to, done) {
  clearInterval(fadeTimer); const s=store.read();
  if (!s.fade || s.reduceMotion || systemReducedMotion || smoke) { pet.setOpacity(to); done?.(); return; }
  const start=Date.now(); pet.setOpacity(from);
  fadeTimer=setInterval(()=>{const p=Math.min(1,(Date.now()-start)/220);pet.setOpacity(from+(to-from)*p);if(p===1){clearInterval(fadeTimer);done?.();}},20);
}
function showPet() { petVisible=true; menuUntil = 0; drag = null; pet.showInactive(); fadeWindow(0,1); broadcast(); }
function hidePet() { petVisible=false;drag = null; menuUntil = 0; fadeWindow(pet.getOpacity(),0,()=>{pet.hide();pet.setOpacity(1);broadcast();}); broadcast(); }
function openApp() {
  if (!careWindow || careWindow.isDestroyed()) {
    // Windows: frameless window with native caption buttons tinted to the app; the app header acts as the title bar.
    const chrome = process.platform === 'win32'
      ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#f5f1e8', symbolColor: '#252326', height: 40 } }
      : {};
    careWindow = new BrowserWindow({ width: 510, height: 810, minWidth: 360, minHeight: 550, title: 'TinyFrens', backgroundColor: '#f5f1e8', show: false, ...chrome, webPreferences: preferences() });
    careWindow.removeMenu();
    secureWindow(careWindow, path.join(__dirname, 'web/index.html')).catch(() => {});
    careWindow.once('ready-to-show', () => careWindow.show());
    careWindow.on('close', event => { if (!quitting) { event.preventDefault(); careWindow.hide(); } });
  } else { careWindow.show(); careWindow.focus(); broadcast(); }
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: petVisible ? 'Hide pet' : 'Show pet', click: () => petVisible ? hidePet() : showPet() },
    { label: 'Open TinyFrens', click: openApp },
    { label: 'Bring pet back to this screen', click: () => { recover(); showPet(); } },
    { label: 'Check for updates', click: () => { openApp(); careWindow.webContents.send('tinyfrens:animation', 'check-update'); } },
    { type: 'separator' }, { label: 'Quit TinyFrens', click: () => app.quit() }
  ]));
}
function moveTick() {
  const now = Date.now(), elapsed = Math.min(.1, (now - lastTick) / 1000); lastTick = now;
  if (!petVisible || !pet?.isVisible()) return;
  const pointer = screen.getCursorScreenPoint(), bounds = pet.getBounds();
  if (drag) {
    if (now - drag.started > 20000) drag = null;
    else {
      const area = screen.getDisplayNearestPoint(pointer).workArea;
      moving = clampPosition({ x: drag.x + pointer.x - drag.pointer.x, y: drag.y + pointer.y - drag.pointer.y }, area, WIDTH, HEIGHT);
      pet.setPosition(moving.x, moving.y); target = null;
    }
  }
  const over = hits(pointer, bounds, regions);
  const ignore = !drag && !over;
  if (ignore !== ignoring) { pet.setIgnoreMouseEvents(ignore, { forward: true }); ignoring = ignore; }
  if (drag || over || now < menuUntil || now < sleepingUntil) return;
  const state = store.read();
  if (state.mode !== 'roam' || state.energy < 15 || state.reduceMotion || systemReducedMotion) return;
  const area = screen.getDisplayMatching(bounds).workArea;
  if (!moving) moving = { x: bounds.x, y: bounds.y };
  if (now > nextTarget) {
    target = Math.random() < .25 ? null : clampPosition({ x: moving.x + (Math.random() - .5) * 500, y: moving.y + (Math.random() - .5) * 280 }, area, WIDTH, HEIGHT);
    nextTarget = now + 2500 + Math.random() * 4000;
  }
  if (!target) return;
  const dx = target.x - moving.x, dy = target.y - moving.y, distance = Math.hypot(dx, dy), step = state.speed * elapsed;
  if (distance < 2) { target = null; return; }
  moving = clampPosition({ x: moving.x + dx / distance * Math.min(step, distance), y: moving.y + dy / distance * Math.min(step, distance) }, area, WIDTH, HEIGHT);
  pet.setPosition(moving.x, moving.y);
}
// Background auto-updater (electron-updater): downloads silently, installs on restart or quit.
let updaterReady = false, autoUpdater = null, updateWaiters = new Set(), checking = false, downloadedVersion = null;
function updateEvent(payload) { for (const win of [pet, careWindow]) if (win && !win.isDestroyed()) win.webContents.send('tinyfrens:update', payload); }
function settleUpdate(result) { checking = false; const waiters = [...updateWaiters]; updateWaiters.clear(); for (const resolve of waiters) resolve(result); }
function ensureUpdater() {
  if (updaterReady) return !!autoUpdater;
  updaterReady = true;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch { return false; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => updateEvent({ type: 'checking' }));
  autoUpdater.on('update-not-available', () => settleUpdate({ available: false }));
  autoUpdater.on('update-available', info => updateEvent({ type: 'available', version: info?.version }));
  autoUpdater.on('download-progress', progress => updateEvent({ type: 'progress', percent: Math.round(progress?.percent || 0) }));
  autoUpdater.on('update-downloaded', info => {
    downloadedVersion = info?.version || app.getVersion();
    updateEvent({ type: 'downloaded', version: downloadedVersion });
    settleUpdate({ available: true, downloaded: true, version: downloadedVersion });
  });
  autoUpdater.on('error', error => {
    if (error) console.warn('TinyFrens updater:', error.message || error);
    updateEvent({ type: 'error' });
    settleUpdate({ error: true });
  });
  return true;
}
function autoUpdateCheck() {
  if (!ensureUpdater()) return Promise.resolve({ available: false, version: app.getVersion(), url: RELEASES });
  if (downloadedVersion) return Promise.resolve({ available: true, downloaded: true, version: downloadedVersion, auto: true });
  return new Promise(resolve => {
    const done = result => { clearTimeout(timer); resolve({ ...result, auto: true }); };
    const timer = setTimeout(() => { if (updateWaiters.delete(done)) resolve({ error: true, auto: true }); }, 45000);
    updateWaiters.add(done);
    if (checking) return;
    checking = true;
    autoUpdater.checkForUpdates().catch(() => settleUpdate({ error: true }));
  });
}
async function checkUpdate() {
  if (autoUpdate) return autoUpdateCheck();
  const response = await net.fetch('https://api.github.com/repos/dutchiono/TinyFrens/releases/tags/desktop-latest', { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) { if (response.status === 404) return { available: false, version: app.getVersion(), unpublished: true }; throw new Error('Update check unavailable'); }
  const release = await response.json();
  const match = /Desktop version: (\d+\.\d+\.\d+)/.exec(release.body || '');
  if (!match) throw new Error('Missing version');
  const parts = version => version.split('.').map(Number), old = parts(app.getVersion()), newer = parts(match[1]);
  let available = false;
  for (let i = 0; i < 3; i++) if (newer[i] !== old[i]) { available = newer[i] > old[i]; break; }
  return { available, version: match[1], url: RELEASES };
}
async function smokeTest() {
  const assert = require('node:assert/strict');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const deadline = setTimeout(() => { console.error('Desktop smoke test timed out'); finishSmoke(1); }, 30000);
  const js = source => careWindow.webContents.executeJavaScript(source);
  try {
    for (let i = 0; i < 200 && (pet.webContents.isLoading() || careWindow.webContents.isLoading() || !pet.isVisible()); i++) await pause(100);
    assert.equal(pet.isAlwaysOnTop(), true);
    assert.equal(pet.hasShadow(), false);
    assert.equal(pet.isVisible(), true);
    assert.equal(await js('typeof window.TinyFrensDesktop'), 'object');
    assert.equal(await js('typeof require'), 'undefined');
    assert.equal(await js('document.getElementById("start").textContent'), 'Hide pet');
    await js('document.getElementById("play").click()');
    await pause(100);
    assert.equal(store.read().energy, 68); assert.equal(store.read().hunger, 72);
    await js('document.getElementById("petShape").value="robot";document.getElementById("petShape").dispatchEvent(new Event("change"))');
    await pause(100);
    assert.equal(await pet.webContents.executeJavaScript('document.getElementById("pet").dataset.shape'), 'robot');
    await js('document.getElementById("petOpacity").value="55";document.getElementById("petOpacity").dispatchEvent(new Event("input"))');
    await pause(100);assert.equal(store.read().opacity,55);
    assert.equal(await pet.webContents.executeJavaScript('document.getElementById("pet").style.opacity'),'0.55');
    await pet.webContents.executeJavaScript('document.querySelector("[data-action=feed]").click()');
    await pause(100);
    assert.equal(store.read().hunger, 97);
    assert.equal(await js('document.getElementById("hungerText").textContent'), '97');
    await pet.webContents.executeJavaScript('document.getElementById("closePet").click()');
    await pause(100);
    assert.equal(pet.isVisible(), false);
    assert.equal(await js('document.getElementById("start").textContent'), 'Show pet');
    await js('document.getElementById("start").click()');
    await pause(100); assert.equal(pet.isVisible(), true);
    const before = pet.getBounds(), area = screen.getDisplayMatching(before).workArea;
    moving = { x: before.x, y: before.y }; target = clampPosition({ x: before.x - 100, y: before.y - 50 }, area, WIDTH, HEIGHT); nextTarget = Date.now() + 5000; menuUntil = 0; regions = []; sleepingUntil = 0;
    // CI machines may enable system reduced motion. Check its pause, then explicitly exercise movement.
    systemReducedMotion=true;lastTick=Date.now()-100;moveTick();assert.equal(pet.getBounds().x,before.x);systemReducedMotion=false;
    // Tick explicitly so renderer hit-region updates cannot pause this movement assertion.
    for (let i = 0; i < 8; i++) { regions = []; lastTick = Date.now() - 100; moveTick(); }
    assert.notEqual(pet.getBounds().x, before.x);
    // Exercise real packaged navigation and IPC using explicit fixture artwork, without a live wallet.
    await careWindow.loadFile(path.join(__dirname, 'web/hood-turtles.html'));
    assert.equal(await js('typeof TinyFrensDesktop.turtleRequest'), 'function');
    turtles.fetch = async () => ({ok:true, text:async () => JSON.stringify({active:true, tokenId:7,
      name:'Smoke fixture', image:'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="green"/></svg>').toString('base64'), validUntil:Date.now()/1000 + 3600})});
    await js(`TinyFrensDesktop.turtleRequest('${SERVER}', '/native/import-turtle', {token:'smoke-fixture', tokenId:7})`);
    await pause(200);
    assert.equal(await pet.webContents.executeJavaScript('document.getElementById("pet").dataset.turtle'), 'true');
    assert.equal(await pet.webContents.executeJavaScript('document.querySelector(".overlay-turtle").naturalWidth'), 64);
    await js('TinyFrensDesktop.clearTurtle()'); await pause(100);
    assert.equal(await pet.webContents.executeJavaScript('document.getElementById("pet").dataset.turtle'), 'false');
    console.log('Desktop smoke passed: isolated renderer, always-on-top overlay, shared care, movement, packaged import navigation, turtle IPC/artwork/unload.');
    clearTimeout(deadline); finishSmoke(0);
  } catch (error) { console.error(error); clearTimeout(deadline); finishSmoke(1); }
}
function finishSmoke(code) {
  quitting = true; clearInterval(tick); clearInterval(fadeTimer);
  for (const win of [pet, careWindow]) if (win && !win.isDestroyed()) win.destroy();
  tray?.destroy(); app.exit(code);
}
ipcMain.on('tinyfrens:sync', (event, name, value) => {
  if (!trusted(event) || !store) { event.returnValue = null; return; }
  try {
    switch (name) {
      case 'state': event.returnValue = JSON.stringify(snapshot()); break;
      case 'turtle': event.returnValue = JSON.stringify(turtles.view()); break;
      case 'clear-turtle': turtles.clear(); broadcastTurtle(); event.returnValue = true; break;
      case 'visible': event.returnValue = petVisible; break;
      case 'toggle': if (petVisible) hidePet(); else showPet(); event.returnValue = petVisible; break;
      case 'hide': hidePet(); event.returnValue = true; break;
      case 'open': openApp(); event.returnValue = true; break;
      case 'rename': event.returnValue = JSON.stringify(store.rename(typeof value === 'string' ? value : '')); broadcast(); break;
      case 'customize': {
        const data = typeof value === 'string' && value.length < 1024 ? JSON.parse(value) : {};
        if (!data || typeof data !== 'object') throw new Error('Invalid look');
        event.returnValue = JSON.stringify(store.customize(data)); broadcast(); break;
      }
      case 'mode': event.returnValue = JSON.stringify(store.mode(value)); broadcast(); break;
      case 'action': {
        if (!['feed', 'play', 'rest', 'clean', 'vitamin', 'wave', 'dance', 'toy'].includes(value)) throw new Error('Invalid action');
        const result = store.action(value); event.returnValue = JSON.stringify(result); broadcast(result);
        if (!result.blocked) { if (result.animation === 'sleep') sleepingUntil = Date.now() + 15000; animate(result.animation || value); }
        break;
      }
      case 'menu': if (event.sender === pet.webContents) menuUntil = value === true ? Date.now() + 8500 : 0; event.returnValue = true; break;
      case 'motion': if (event.sender === pet.webContents) systemReducedMotion = value === true; event.returnValue = true; break;
      case 'drag': if (event.sender === pet.webContents) { const b = pet.getBounds(); drag = value === true ? { x: b.x, y: b.y, pointer: screen.getCursorScreenPoint(), started: Date.now() } : null; if (!drag) { moving = { x: b.x, y: b.y }; target = null; } } event.returnValue = true; break;
      case 'update': external(RELEASES); event.returnValue = true; break;
      default: event.returnValue = null;
    }
  } catch { event.returnValue = name === 'customize' || name === 'action' ? JSON.stringify(snapshot({ blocked: true, feedback: 'Try again.' })) : null; }
});
ipcMain.on('tinyfrens:regions', (event, data) => {
  if (!trusted(event) || event.sender !== pet?.webContents || !Array.isArray(data)) return;
  regions = data.slice(0, 8).filter(r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && r.width > 0 && r.height > 0 && r.x >= -20 && r.y >= -20 && r.x + r.width <= WIDTH + 20 && r.y + r.height <= HEIGHT + 20);
});
ipcMain.handle('tinyfrens:check-update', async event => {
  if (!trusted(event)) return { error: true };
  try { return await checkUpdate(); } catch { return { error: true }; }
});
ipcMain.handle('tinyfrens:turtle-request', async (event, server, route, body) => {
  if (!trusted(event) || event.sender !== careWindow?.webContents) throw new Error('Untrusted turtle request');
  if (route === '/native/import-turtle') {
    if (server !== SERVER) throw new Error('Unsupported turtle server');
    const result = await turtles.import(server, body); broadcastTurtle(); return result;
  }
  return turtles.request(server, route, body);
});
ipcMain.handle('tinyfrens:install-update', event => {
  if (!trusted(event) || !autoUpdater || !downloadedVersion) return false;
  try {
    if (process.platform === 'win32') autoUpdater.quitAndInstall(true, true);
    else autoUpdater.quitAndInstall();
    return true;
  } catch { return false; }
});
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (store) openApp(); });
  app.whenReady().then(() => {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    store = new PetStore(path.join(app.getPath('userData'), 'pet.json'));
    turtles = new TurtleStore(path.join(app.getPath('userData'), 'turtle.json'), (...args) => net.fetch(...args));
    session.defaultSession.setPermissionRequestHandler((_, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    pet = new BrowserWindow({ width: WIDTH, height: HEIGHT, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, show: false, webPreferences: preferences() });
    pet.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') pet.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    pet.setIgnoreMouseEvents(true, { forward: true });
    secureWindow(pet, path.join(__dirname, 'overlay.html')).catch(() => {});
    pet.once('ready-to-show', () => { recover(); showPet(); });
    pet.on('close', event => { if (!quitting) { event.preventDefault(); hidePet(); } });
    let icon = nativeImage.createFromPath(path.join(__dirname, 'web/icons/icon-192.png')).resize({ width: 20, height: 20 });
    tray = new Tray(icon); tray.setToolTip('TinyFrens'); tray.on('double-click', openApp); updateTray();
    const restore = () => { recover(); broadcast(); };
    screen.on('display-removed', restore); screen.on('display-metrics-changed', restore);
    tick = setInterval(moveTick, 50);
    turtleTick = setInterval(async () => { if (await turtles.renew()) broadcastTurtle(); }, 1000);
    openApp();
    if (smoke) smokeTest();
  }).catch(error => { console.error('TinyFrens startup failed:', error); app.exit(1); });
}
app.on('activate', () => { if (store && !quitting) openApp(); });
app.on('window-all-closed', () => {});
app.on('before-quit', () => { quitting = true; clearInterval(tick); clearInterval(turtleTick); clearInterval(fadeTimer); if (store) { store.read(); store.save(); } });
