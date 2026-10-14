const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Testing TinyFrens Farcaster Snap Generator & Interactive In-Feed Flow...');

const snapJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'snap.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(__dirname, '..', 'web', 'style.css'), 'utf8');
const appPy = fs.readFileSync(path.join(__dirname, '..', 'server', 'app.py'), 'utf8');
const snapIndexTs = fs.readFileSync(path.join(__dirname, '..', 'snap', 'src', 'index.ts'), 'utf8');

// 1. Verify all faux-AR / camera artifacts are completely purged
assert(!snapJs.includes('getUserMedia'), 'snap.js must not contain getUserMedia');
assert(!snapJs.includes('snapVideo'), 'snap.js must not contain snapVideo');
assert(!snapJs.includes('snapFlash'), 'snap.js must not contain snapFlash');
assert(!snapJs.includes('viewfinder'), 'snap.js must not contain viewfinder');
assert(!styleCss.includes('.snap-viewfinder'), 'style.css must not contain .snap-viewfinder');
assert(!styleCss.includes('.snap-shutter'), 'style.css must not contain .snap-shutter');
assert(!appPy.includes('AR camera snaps'), 'server/app.py must not mention AR camera snaps');
assert(!snapIndexTs.includes('AR camera snaps'), 'snap/src/index.ts must not mention AR camera snaps');
console.log('✅ Purged camera/viewfinder/AR misconceptions');

// 2. Verify Character Discovery & Wired Companion Support
assert(snapJs.includes('tinyfrens-companions'), 'snap.js must check tinyfrens-companions storage');
assert(snapJs.includes('petState'), 'snap.js must support pet Fren state');
assert(snapJs.includes('hood-turtles-v1'), 'snap.js must support Hood Turtles adapter');
assert(snapJs.includes('tinyfrens-robots-v1'), 'snap.js must support Robots v1 adapter');
assert(snapJs.includes('getAvailableCharacters'), 'snap.js must implement getAvailableCharacters');
assert(snapJs.includes('renderCharacter'), 'snap.js must implement renderCharacter');
console.log('✅ Character resolution & companion wiring verified');

// 3. Verify Interactive In-Feed Snap Simulation
assert(snapJs.includes('triggerSnapReaction'), 'snap.js must implement triggerSnapReaction');
assert(snapJs.includes('snap-hero-anim-pet'), 'snap.js must trigger pet reaction animation');
assert(snapJs.includes('snap-hero-anim-feed'), 'snap.js must trigger feed reaction animation');
assert(snapJs.includes('snap-hero-anim-play'), 'snap.js must trigger play reaction animation');
assert(snapJs.includes('You petted'), 'snap.js must provide cute in-feed response for Pet');
assert(snapJs.includes('fresh strawberry'), 'snap.js must provide cute in-feed response for Feed');
assert(snapJs.includes('Joy is at 100%'), 'snap.js must provide cute in-feed response for Play');
console.log('✅ Interactive in-feed simulation (Pet, Feed, Play) verified');

// 4. Verify Sharing & Export Tools
assert(snapJs.includes('castOnFarcaster'), 'snap.js must implement castOnFarcaster');
assert(snapJs.includes('copySnapLink'), 'snap.js must implement copySnapLink');
assert(snapJs.includes('saveCardImage'), 'snap.js must implement saveCardImage');
assert(snapJs.includes('canvas.toDataURL'), 'snap.js must render card image via canvas on demand');
assert(snapJs.includes('tinyfrens-snap.png') || snapJs.includes('-farcaster-snap.png'),
  'snap.js must save as .png card');
console.log('✅ Sharing & Card Image export verified');

// 5. Test logic functions in isolated VM
const vm = require('vm');
const context = {
  window: {
    location: { origin: 'https://tinyfrens.lol' },
    addEventListener: () => {}
  },
  document: {
    readyState: 'complete',
    getElementById: () => null,
    createElement: (tag) => ({
      style: {},
      classList: { add: () => {}, remove: () => {} },
      appendChild: () => {}
    }),
    body: { appendChild: () => {} }
  },
  localStorage: {
    getItem: (k) => {
      if (k === 'tinyfrens-companions') {
        return JSON.stringify([{
          name: 'Hood #42',
          tokenId: 42,
          chainId: 4663,
          originalAddress: '0xca28587b61eac19a87dfcfd9420870867a916675',
          companion: { adapter: 'hood-turtles-v1', frames: ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='] },
          active: true,
          validUntil: Math.floor(Date.now() / 1000) + 86400
        }]);
      }
      return null;
    }
  },
  read: () => ({ name: 'Mochi', shape: 'cat', color: '#a474f1', expression: 'happy', accessory: 'none' })
};
vm.createContext(context);
vm.runInContext(snapJs, context);

assert(context.window.TinyFrensSnap, 'window.TinyFrensSnap must be exported');
const chars = context.window.TinyFrensSnap.getCharacters();
assert(chars.length === 2, 'Should discover both imported NFT companion and pet Fren');
assert(chars[0].name === 'Hood #42', 'First character should be active NFT');
assert(chars[0].collection === 'Hood Turtles', 'First character collection should be Hood Turtles');
assert(chars[1].name === 'Mochi', 'Second character should be pet Fren Mochi');

const nftUrl = context.window.TinyFrensSnap.getSnapUrl(chars[0]);
assert(nftUrl.includes('/snap?nft=42'), `NFT Snap URL should contain ?nft=42, got: ${nftUrl}`);

const petUrl = context.window.TinyFrensSnap.getSnapUrl(chars[1]);
assert(petUrl.includes('/snap?name=Mochi&species=Cat'), `Pet Snap URL should contain ?name=Mochi&species=Cat, got: ${petUrl}`);

console.log('✅ VM unit execution and URL generation passed');

console.log('🎉 ALL FARCASTER SNAP TESTS PASSED SUCCESSFULLY!');
