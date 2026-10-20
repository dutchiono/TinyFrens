import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const web = read('web/index.html');
const desktopMain = read('desktop/main.cjs');
const desktopOverlay = read('desktop/overlay.html');
const desktopPrepare = read('desktop/prepare.cjs');
const androidBuild = read('android/app/build.gradle.kts');
const androidMain = read('android/app/src/main/java/com/example/floatingpet/MainActivity.kt');
const androidOverlay = read('android/app/src/main/java/com/example/floatingpet/PetOverlayService.kt');
const communityCompanion = read('web/companion.js');

assert.equal(fs.existsSync('web/customize.js'), false, 'The removed generic pet customizer must not return.');
for (const legacy of ['customize.js', 'petShape', 'petColor', 'tab-looks', 'screen-looks']) {
  assert.equal(web.includes(legacy), false, `web/index.html exposes legacy customization: ${legacy}`);
}
assert.match(web, /companion-actions\.js/, 'Shared companion actions must come from the canonical web surface.');

assert.match(desktopPrepare, /cpSync\(path\.join\(__dirname, '\.\.\/web'\), target/, 'Desktop must package the canonical web app.');
assert.match(read('desktop/.gitignore'), /^web\/$/m, 'Generated desktop web assets must stay untracked.');
assert.match(androidBuild, /assets\.srcDir\("\.\.\/\.\.\/web"\)/, 'Android must embed the canonical web app.');

assert.equal(desktopOverlay.includes('class="pet"'), false, 'Desktop must not render a generic fallback pet.');
assert.match(desktopMain, /petVisible && turtles\.view\(\)\.active/, 'Desktop overlays must require a verified NFT companion.');
assert.match(androidMain, /TurtleStore\(this@MainActivity\)\.all\(\)\.isEmpty\(\)/, 'Android must refuse to float without a verified NFT companion.');
assert.match(androidOverlay, /if\(companions\.isEmpty\(\)\)\{stopSelf\(\);return\}/, 'Android overlay must stop when no verified NFT remains.');
assert.match(communityCompanion, /\.collection-companion/, 'Telegram and Discord must use the selected verified NFT artwork.');
assert.equal(communityCompanion.includes('cloneNode(true)'), false, 'Community apps must not clone the generic pet sprite.');

console.log('Universal surface check passed: one shared web app, NFT-only companion rendering, no generic customizer.');
