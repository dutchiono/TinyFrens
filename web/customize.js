'use strict';
const styleSection = document.createElement('section');
styleSection.className = 'overlay studio-panel';
styleSection.innerHTML = `
  <div class="studio-stage-box">
    <div id="lookPreview" class="look-preview" aria-label="Appearance preview"></div>
    <div class="studio-anim-row">
      <button type="button" class="studio-anim-btn active" data-test-anim="idle">✨ Idle</button>
      <button type="button" class="studio-anim-btn" data-test-anim="dance">🎵 Dance</button>
      <button type="button" class="studio-anim-btn" data-test-anim="wave">👋 Wave</button>
      <button type="button" class="studio-anim-btn" data-test-anim="eat">🍓 Eat</button>
      <button type="button" class="studio-anim-btn" data-test-anim="sleep">☾ Nap</button>
    </div>
  </div>

  <label for="petShape">Species</label>
  <select id="petShape">
    <option value="cat">🐱 Cat</option>
    <option value="blob">💧 Blob</option>
    <option value="robot">🤖 Robot</option>
    <option value="bunny">🐰 Bunny</option>
    <option value="duck">🦆 Duck</option>
    <option value="pig">🐷 Pig</option>
    <option value="frog">🐸 Frog</option>
    <option value="turtle">🐢 Turtle</option>
  </select>

  <label for="petExpression">Expression & Eyes</label>
  <select id="petExpression">
    <option value="happy">😊 Classic Happy</option>
    <option value="wink">😉 Playful Wink</option>
    <option value="shades">😎 Cool Shades</option>
    <option value="star_eyes">🤩 Star Eyes</option>
    <option value="sleepy">😴 Sleepy</option>
    <option value="loving">😍 Loving Hearts</option>
    <option value="laser">⚡ Cyber Laser</option>
    <option value="grin">😁 Cheerful Grin</option>
  </select>

  <label for="petAccessory">Accessory</label>
  <select id="petAccessory">
    <option value="none">None</option>
    <option value="party_hat">🎉 Party Hat</option>
    <option value="crown">👑 Royal Crown</option>
    <option value="halo">😇 Angel Halo</option>
    <option value="bow_tie">🎀 Dapper Bow Tie</option>
    <option value="orb">🔮 Mystic Orb</option>
  </select>

  <label>Official Palettes</label>
  <div class="studio-palette-grid">
    <button type="button" class="palette-swatch" data-color="#a474f1" style="background:#a474f1;">Lavender</button>
    <button type="button" class="palette-swatch" data-color="#66c7d2" style="background:#66c7d2;">Cyber</button>
    <button type="button" class="palette-swatch" data-color="#ffb95e" style="background:#ffb95e;">Sunny</button>
    <button type="button" class="palette-swatch" data-color="#82eba1" style="background:#82eba1;">Mint</button>
    <button type="button" class="palette-swatch" data-color="#ff82a7" style="background:#ff82a7;">Bubblegum</button>
    <button type="button" class="palette-swatch" data-color="#4d96ff" style="background:#4d96ff;">Electric</button>
    <button type="button" class="palette-swatch" data-color="#3a2d52" style="background:#3a2d52;">Midnight</button>
    <button type="button" class="palette-swatch" data-color="#ffd700" style="background:#ffd700;color:#000;">24K Gold</button>
  </div>

  <label for="petColor">Custom Colour</label>
  <input id="petColor" type="color" value="#a474f1">

  <label for="petSize">Size <output id="sizeValue">80</output></label>
  <input id="petSize" type="range" min="56" max="128" value="80">

  <!-- Imported NFTs have individual movement controls on Show NFTs. -->
  <div hidden><output id="speedValue">60</output><input id="petSpeed" type="range" min="20" max="140" value="60" aria-label="Legacy fren speed"></div>

  <!-- On-chain Spec Compiler -->
  <div class="compiler-box">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-weight:700;font-size:12px;color:#c8b1fa;">⚡ On-chain Trait Compiler</span>
      <button type="button" id="copySpecButton" class="secondary" style="padding:4px 8px;font-size:11px;">📋 Copy</button>
    </div>
    <pre id="compilerOutput">{}</pre>
  </div>

  <p class="small">Minting a custom TinyFren to your own wallet is not available yet. You can still save this look on your fren.</p>
  <button type="button" id="studioSaveNftButton" class="secondary" style="margin-top:8px;width:100%;display:none;">💾 Save Look to Equipped NFT (50% Burn / 50% Treasury)</button>

  <div class="nft-sync-box" style="margin:20px 0 10px;padding:14px;background:#241d3d;border:1px solid #4a3a6c;border-radius:12px;">
    <label for="nftTokenInput" style="font-weight:700;margin:0 0 4px">Replicate Existing TinyFren NFT</label>
    <p class="small" style="margin:2px 0 8px;color:#a496c8;">Enter a token ID (#1–#2664) to preview its robot-only BNKR look. Minted traits may differ.</p>
    <div class="actions" style="margin:0">
      <input id="nftTokenInput" type="number" min="1" max="2664" placeholder="Token # (1–2664)" style="background:#17142a;color:#fff;border-radius:8px;padding:8px;width:100%">
      <button id="syncNftButton" type="button" class="secondary" style="flex:none">Sync Look</button>
    </div>
  </div>

  <div class="actions"><button id="resetStyle" class="secondary">Reset to Classic</button></div>
  <p id="styleMessage" role="status"></p>
`;

$('lookPanel').replaceChildren(styleSection);

const validShapes = ['cat', 'blob', 'robot', 'bunny', 'duck', 'pig', 'frog', 'turtle'];
const validAccs = ['none', 'party_hat', 'crown', 'halo', 'bow_tie', 'orb'];
const validExprs = ['happy', 'wink', 'shades', 'star_eyes', 'sleepy', 'loving', 'laser', 'grin'];

function normalizeShape(s) {
  if (s === 'mascot') return 'robot';
  if (s === 'dog') return 'duck';
  if (s === 'bear') return 'pig';
  return validShapes.includes(s) ? s : 'cat';
}

function nftTraits(tokenId) {
  const PALETTES = ['#a474f1', '#66c7d2', '#ffb95e', '#82eba1', '#ff82a7', '#4d96ff', '#76638e', '#ffd700'];
  const EXPRS = ['happy', 'wink', 'shades', 'star_eyes'];
  const ACCS = ['none', 'party_hat', 'crown', 'halo', 'bow_tie', 'orb'];
  const species = 'robot';
  const artIndex = ((Number(tokenId) - 1) % 888 * 197 + 17) % 4608;
  const color = PALETTES[artIndex % PALETTES.length];
  const combination = Math.floor(artIndex / PALETTES.length);
  const expr = EXPRS[combination % EXPRS.length];
  const acc = ACCS[Math.floor(combination / 4) % ACCS.length];
  return {
    shape: species,
    color,
    expression: expr,
    accessory: acc,
    tokenId: Number(tokenId)
  };
}

let activePreviewAction = 'idle';

function updateCompilerOutput(traits) {
  const output = document.getElementById('compilerOutput');
  if (output) {
    output.textContent = JSON.stringify({
      species: traits.shape,
      color: traits.color,
      expression: traits.expression,
      accessory: traits.accessory,
      solidityIndex: validShapes.indexOf(traits.shape)
    }, null, 2);
  }
}

function stylePet(s) {
  s = s || read();
  const color = /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#a474f1';
  const shape = normalizeShape(s.shape);
  const expr = validExprs.includes(s.expression) ? s.expression : 'happy';
  const acc = validAccs.includes(s.accessory) ? s.accessory : 'none';

  $('petColor').value = color;
  $('petShape').value = shape;
  $('petExpression').value = expr;
  $('petAccessory').value = acc;
  $('petSize').value = s.size || 80;
  $('petSpeed').value = s.speed || 60;
  if (s.tokenId) $('nftTokenInput').value = s.tokenId;
  $('sizeValue').textContent = s.size || 80;
  $('speedValue').textContent = s.speed || 60;

  $('pet').style.setProperty('--pet-color', color);
  $('pet').style.setProperty('--pet-scale', String((s.size || 80) / 80));
  $('pet').dataset.shape = shape;
  $('pet').dataset.expression = expr;
  $('pet').dataset.accessory = acc;
  $('pet').style.setProperty('--wander-time', String(500 / (s.speed || 60)) + 's');

  // Highlight palette swatch if matching
  document.querySelectorAll('.palette-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color.toLowerCase() === color.toLowerCase());
  });

  const preview = $('pet').cloneNode(true);
  preview.removeAttribute('id');
  preview.dataset.action = activePreviewAction === 'idle' ? '' : activePreviewAction;
  preview.style.animation = activePreviewAction === 'idle' ? 'bob 1.5s steps(2,end) infinite' : '';
  $('lookPreview').replaceChildren(preview);
  updateCompilerOutput({ shape, color, expression: expr, accessory: acc });
  const saveBtn = document.getElementById('studioSaveNftButton');
  if (saveBtn) {
    if (s.tokenId) {
      saveBtn.style.display = 'block';
      saveBtn.textContent = '💾 Save Look to TinyFren #' + s.tokenId + ' (50% Burn / 50% Treasury)';
    } else {
      saveBtn.style.display = 'none';
    }
  }
}

function saveLook(reset) {
  const data = reset ? { color: '#a474f1', shape: 'cat', expression: 'happy', accessory: 'none', size: 80, speed: 60, tokenId: null } : {
    color: $('petColor').value,
    shape: $('petShape').value,
    expression: $('petExpression').value,
    accessory: $('petAccessory').value,
    size: Number($('petSize').value),
    speed: Number($('petSpeed').value),
    tokenId: $('nftTokenInput').value ? Number($('nftTokenInput').value) : null
  };
  applyImmediateLook(data);
  let state;
  if (desktop) state = JSON.parse(desktop.customize(JSON.stringify(data)));
  else if (native) state = JSON.parse(PetAndroid.customize(JSON.stringify(data)));
  else { state = localBridge('customize', data); }
  stylePet(state);
  render(state);
  window.dispatchEvent(new Event('pet-profile-changed'));
  $('styleMessage').textContent = (native || desktop) ? 'Saved! Your floating fren changes immediately.' : 'Look saved!';
}

function applyImmediateLook(data) {
  const p = $('pet');
  if (p) {
    if (data.color) p.style.setProperty('--pet-color', data.color);
    if (data.shape) p.dataset.shape = normalizeShape(data.shape);
    if (data.expression) p.dataset.expression = data.expression;
    if (data.accessory) p.dataset.accessory = data.accessory;
    if (data.size) p.style.setProperty('--pet-scale', String(data.size / 80));
  }
  const preview = $('lookPreview')?.querySelector('.pet');
  if (preview) {
    if (data.color) preview.style.setProperty('--pet-color', data.color);
    if (data.shape) preview.dataset.shape = normalizeShape(data.shape);
    if (data.expression) preview.dataset.expression = data.expression;
    if (data.accessory) preview.dataset.accessory = data.accessory;
  }
}

$('resetStyle').onclick = () => saveLook(true);
for (const id of ['petColor', 'petSize', 'petSpeed']) $(id).addEventListener('input', () => saveLook(false));
for (const id of ['petShape', 'petExpression', 'petAccessory']) {
  $(id).addEventListener('change', () => saveLook(false));
  $(id).addEventListener('input', () => saveLook(false));
}

document.querySelectorAll('.palette-swatch').forEach(btn => {
  btn.onclick = () => {
    $('petColor').value = btn.dataset.color;
    saveLook(false);
  };
});

// Interactive Animation / Pose Testing
document.querySelectorAll('[data-test-anim]').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('[data-test-anim]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activePreviewAction = btn.dataset.testAnim;
    animatePet(activePreviewAction === 'idle' ? '' : activePreviewAction);
    stylePet(read());
  };
});

$('syncNftButton').onclick = () => {
  const id = parseInt($('nftTokenInput').value, 10);
  if (!id || id < 1 || id > 2664) { $('styleMessage').textContent = 'Enter a valid token ID between 1 and 2664.'; return; }
  const t = nftTraits(id);
  $('petColor').value = t.color;
  $('petShape').value = t.shape;
  $('petExpression').value = t.expression;
  $('petAccessory').value = t.accessory;
  saveLook(false);
  $('styleMessage').textContent = 'Previewed TinyFren #' + id + ' appearance. Load its on-chain metadata for the minted look.';
};

// Copy Spec
const copySpecBtn = document.getElementById('copySpecButton');
if (copySpecBtn) {
  copySpecBtn.onclick = async () => {
    const text = document.getElementById('compilerOutput')?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      copySpecBtn.textContent = 'Copied! ✓';
      setTimeout(() => { copySpecBtn.textContent = '📋 Copy'; }, 2000);
    } catch {
      prompt('Copy trait spec:', text);
    }
  };
}

const studioSaveBtn = document.getElementById('studioSaveNftButton');
if (studioSaveBtn) {
  studioSaveBtn.onclick = async () => {
    const cur = read();
    if (!cur.tokenId) {
      $('styleMessage').textContent = 'Equip an NFT first to save custom look to it.';
      return;
    }
    studioSaveBtn.disabled = true;
    $('styleMessage').textContent = `Saving look to TinyFren #${cur.tokenId} (50% burn / 50% treasury)...`;
    try {
      const server = String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
      const idData = JSON.parse(localStorage.getItem('tinyfrens-identity') || '{}');
      const token = idData.token;
      if (!token) throw new Error('Connect your fren identity first');
      const res = await fetch(server + '/api/wallet/save-nft-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          tokenId: cur.tokenId,
          customTraits: { color: cur.color, expression: cur.expression, accessory: cur.accessory },
          name: cur.name
        })
      });
      const data = await res.json();
      if (data.ok) {
        $('styleMessage').textContent = data.message || `🎉 Saved look to TinyFren #${cur.tokenId}!`;
        animatePet('dance');
      } else {
        throw new Error(data.error || 'Could not save look to NFT');
      }
    } catch (err) {
      $('styleMessage').textContent = err.message || 'Save failed.';
    } finally {
      studioSaveBtn.disabled = false;
    }
  };
}

function animatePet(name) {
  $('pet').dataset.action = name || '';
  clearTimeout(window.petActionTimeout);
  if (name) {
    window.petActionTimeout = setTimeout(() => {
      $('pet').dataset.action = '';
      activePreviewAction = 'idle';
      document.querySelectorAll('[data-test-anim]').forEach(b => b.classList.toggle('active', b.dataset.testAnim === 'idle'));
    }, name === 'sleep' ? 15000 : 6000);
  }
}

// Global exports so app.js and other files can call them reliably
window.animatePet = animatePet;
window.stylePet = stylePet;

$('wavePet')?.addEventListener('click', () => {
  if (desktop) desktop.action('wave');
  else if (native) PetAndroid.action('wave');
  animatePet('wave');
  window.tinyFrensEffects?.respond('wave');
});

$('dancePet')?.addEventListener('click', () => {
  if (desktop) desktop.action('dance');
  else if (native) PetAndroid.action('dance');
  animatePet('dance');
  window.tinyFrensEffects?.respond('dance');
});

$('toyPet')?.addEventListener('click', () => {
  window.tinyFrensEffects?.respond('toy');
  if (desktop) { desktop.action('toy'); $('styleMessage').textContent = 'Toy placed beside your floating fren.'; }
  else if (native) { PetAndroid.toy(); $('styleMessage').textContent = 'Toy placed. Show your fren to watch the chase.'; }
  else {
    const stage = $('stage'); stage.classList.add('chasing'); let toy = stage.querySelector('.web-toy');
    if (!toy) { toy = document.createElement('button'); toy.className = 'web-toy'; toy.textContent = '●'; toy.setAttribute('aria-label', 'Move the toy'); stage.append(toy); }
    toy.style.left = (25 + Math.random() * 50) + '%'; toy.onclick = () => $('toyPet').click();
    animatePet('dance'); clearTimeout(window.webToyTimer); window.webToyTimer = setTimeout(() => { stage.classList.remove('chasing'); toy.remove(); }, 6000);
    $('styleMessage').textContent = 'Toy time! Android also supports chasing a toy across your screen.';
  }
});

stylePet(read());
$('stage').classList.toggle('wandering', read().mode !== 'bubble');

if (native) {
  const permissions = document.createElement('section'); permissions.className = 'overlay';
  permissions.innerHTML = '<h2>Android permissions</h2><p id="permissionStatus" role="status"></p><div class="actions"><button data-settings="overlay">Allow floating</button><button data-settings="app">App settings</button><button data-settings="install">Allow updates</button></div><p>Battery and notification controls are in App settings. If Android shows a floating-app list, choose Pocket Familiar.</p>';
  $('settingsPanel').append(permissions);
  for (const b of permissions.querySelectorAll('[data-settings]')) b.onclick = () => PetAndroid.openSettings(b.dataset.settings);
  function refreshPermissions() { const p = JSON.parse(PetAndroid.permissions()); $('permissionStatus').textContent = 'Floating: ' + (p.overlay ? 'allowed' : 'needs permission') + ' · In-app updates: ' + (p.install ? 'allowed' : 'needs permission'); }
  const resume = window.onAndroidResume; window.onAndroidResume = () => { resume?.(); refreshPermissions(); stylePet(read()); };
  refreshPermissions();
}
