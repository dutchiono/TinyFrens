'use strict';
const fs = require('node:fs');
const path = require('node:path');
const target = path.join(__dirname, 'web');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(path.join(__dirname, '../web'), target, { recursive: true });
// Desktop uses its packaged renderer and native updates, never a service worker.
let html = fs.readFileSync(path.join(target, 'index.html'), 'utf8');
html = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; media-src \'self\'; connect-src https: wss:; object-src \'none\'; base-uri \'none\'">');
fs.writeFileSync(path.join(target, 'index.html'), html);
