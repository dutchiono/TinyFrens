'use strict';
/**
 * TinyFrens Farcaster Snap Generator & Interactive In-Feed Preview
 * Generates an interactive Farcaster Snap for the user's active companion or Fren pet,
 * supporting in-feed pet care (Pet, Feed, Play) and 1-click sharing to Farcaster/Warpcast.
 */
(() => {
  let modal = null;
  let activeChar = null;
  let animTimer = null;
  let spriteCycleTimer = null;
  let currentFrameIdx = 0;

  function petState() {
    if (typeof read === 'function') {
      try { return read(); } catch {}
    }
    return {
      name: 'Your fren',
      shape: 'cat',
      color: '#a474f1',
      expression: 'happy',
      accessory: 'none'
    };
  }

  function getSpeciesName(s) {
    const map = {
      cat: 'Cat', blob: 'Blob', robot: 'Robot', bunny: 'Bunny',
      duck: 'Duck', pig: 'Pig', frog: 'Frog', turtle: 'Turtle',
      dog: 'Duck', bear: 'Pig'
    };
    return map[s] || 'Fren';
  }

  function generatePetSvg(s) {
    const color = s.color || '#a474f1';
    const dark = '#4b2d77';
    let shape = s.shape || 'cat';
    if (shape === 'dog') shape = 'duck';
    if (shape === 'bear') shape = 'pig';
    const expr = s.expression || 'happy';
    const acc = s.accessory || 'none';

    let bodyRadius = 'rx="38" ry="32"';
    let earsSvg = '';
    let shellSvg = '';
    let snoutSvg = '';
    let feetSvg = `<rect x="25" y="132" width="29" height="12" rx="4" fill="${dark}"/><rect x="74" y="132" width="29" height="12" rx="4" fill="${dark}"/>`;

    if (shape === 'cat') {
      earsSvg = `<polygon points="20,40 36,4 52,40" fill="${color}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
<polygon points="76,40 92,4 108,40" fill="${color}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
<polygon points="28,34 36,16 44,34" fill="#ff82a7"/>
<polygon points="84,34 92,16 100,34" fill="#ff82a7"/>`;
    } else if (shape === 'blob') {
      bodyRadius = 'rx="48" ry="40"';
    } else if (shape === 'robot') {
      earsSvg = `<rect x="60" y="8" width="8" height="24" fill="${dark}"/>
<circle cx="64" cy="8" r="6" fill="#00d2d3" stroke="${dark}" stroke-width="3"/>
<rect x="2" y="60" width="8" height="14" rx="3" fill="${dark}"/>
<rect x="118" y="60" width="8" height="14" rx="3" fill="${dark}"/>`;
      bodyRadius = 'rx="8" ry="8"';
    } else if (shape === 'bunny') {
      earsSvg = `<rect x="26" y="2" width="20" height="50" rx="10" fill="${color}" stroke="${dark}" stroke-width="7"/>
<rect x="82" y="2" width="20" height="50" rx="10" fill="${color}" stroke="${dark}" stroke-width="7"/>
<rect x="30" y="8" width="12" height="38" rx="6" fill="#ffc2d4"/>
<rect x="86" y="8" width="12" height="38" rx="6" fill="#ffc2d4"/>`;
    } else if (shape === 'duck') {
      earsSvg = `<path d="M 58 32 C 54 20 62 14 66 14 C 68 20 66 28 66 32 Z" fill="${color}" stroke="${dark}" stroke-width="3"/>
<path d="M 64 32 C 68 18 76 16 78 20 C 76 26 72 30 70 32 Z" fill="${color}" stroke="${dark}" stroke-width="3"/>`;
      snoutSvg = `<ellipse cx="64" cy="72" rx="14" ry="9" fill="#ff9f43" stroke="${dark}" stroke-width="3"/><circle cx="60" cy="70" r="1.5" fill="${dark}"/><circle cx="68" cy="70" r="1.5" fill="${dark}"/>`;
      feetSvg = `<ellipse cx="38" cy="136" rx="16" ry="6" fill="#ff9f43" stroke="${dark}" stroke-width="3"/><ellipse cx="90" cy="136" rx="16" ry="6" fill="#ff9f43" stroke="${dark}" stroke-width="3"/>`;
    } else if (shape === 'pig') {
      earsSvg = `<polygon points="12,38 28,26 34,48" fill="${color}" stroke="${dark}" stroke-width="6" stroke-linejoin="round"/>
<polygon points="116,38 100,26 94,48" fill="${color}" stroke="${dark}" stroke-width="6" stroke-linejoin="round"/>
<polygon points="16,38 27,29 31,45" fill="#ff82a7"/>
<polygon points="112,38 101,29 97,45" fill="#ff82a7"/>`;
      snoutSvg = `<rect x="50" y="66" width="28" height="18" rx="9" fill="#ff82a7" stroke="${dark}" stroke-width="4"/><circle cx="58" cy="75" r="2.5" fill="${dark}"/><circle cx="70" cy="75" r="2.5" fill="${dark}"/>`;
    } else if (shape === 'frog') {
      earsSvg = `<ellipse cx="36" cy="38" rx="16" ry="14" fill="${color}" stroke="${dark}" stroke-width="7"/><ellipse cx="92" cy="38" rx="16" ry="14" fill="${color}" stroke="${dark}" stroke-width="7"/><circle cx="36" cy="38" r="5" fill="#fff" opacity="0.6"/><circle cx="92" cy="38" r="5" fill="#fff" opacity="0.6"/>`;
      bodyRadius = 'rx="46" ry="38"';
      shellSvg = `<ellipse cx="64" cy="104" rx="28" ry="22" fill="#c8f7c5" opacity="0.85"/>`;
    } else if (shape === 'turtle') {
      bodyRadius = 'rx="48" ry="40"';
      shellSvg = `<ellipse cx="64" cy="84" rx="34" ry="26" fill="none" stroke="${dark}" stroke-width="4" stroke-dasharray="8 6"/>`;
    }

    let eyesSvg = `<rect x="32" y="66" width="12" height="20" rx="3" fill="${dark}"/><rect x="84" y="66" width="12" height="20" rx="3" fill="${dark}"/><circle cx="35" cy="70" r="2.5" fill="#fff"/><circle cx="87" cy="70" r="2.5" fill="#fff"/>`;
    if (expr === 'wink') {
      eyesSvg = `<rect x="32" y="66" width="12" height="20" rx="3" fill="${dark}"/><circle cx="35" cy="70" r="2.5" fill="#fff"/><path d="M 82 76 Q 90 70 98 76" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    } else if (expr === 'shades') {
      eyesSvg = `<rect x="24" y="64" width="36" height="18" rx="3" fill="#111"/><rect x="68" y="64" width="36" height="18" rx="3" fill="#111"/><rect x="56" y="68" width="16" height="4" fill="#111"/><line x1="28" y1="67" x2="52" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/><line x1="72" y1="67" x2="96" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>`;
    } else if (expr === 'star_eyes') {
      eyesSvg = `<polygon points="38,62 41,71 50,71 43,76 46,85 38,80 30,85 33,76 26,71 35,71" fill="#ffd700"/><polygon points="90,62 93,71 102,71 95,76 98,85 90,80 82,85 85,76 78,71 87,71" fill="#ffd700"/>`;
    } else if (expr === 'sleepy') {
      eyesSvg = `<line x1="28" y1="76" x2="44" y2="76" stroke="${dark}" stroke-width="4" stroke-linecap="round"/><line x1="80" y1="76" x2="96" y2="76" stroke="${dark}" stroke-width="4" stroke-linecap="round"/><text x="100" y="50" font-family="sans-serif" font-weight="bold" font-size="16" fill="#c8b1fa">zZ</text>`;
    }

    let accSvg = '';
    if (acc === 'party_hat') {
      accSvg = '<polygon points="64,4 48,32 80,32" fill="#ff4757" stroke="#ffd700" stroke-width="3"/><circle cx="64" cy="4" r="5" fill="#ffd700"/>';
    } else if (acc === 'crown') {
      accSvg = '<polygon points="46,26 46,14 55,20 64,10 73,20 82,14 82,26" fill="#ffd700" stroke="#b7791f" stroke-width="2"/><circle cx="64" cy="10" r="3" fill="#e74c3c"/>';
    } else if (acc === 'halo') {
      accSvg = '<ellipse cx="64" cy="12" rx="30" ry="8" fill="none" stroke="#ffeaa7" stroke-width="5"/>';
    } else if (acc === 'bow_tie') {
      accSvg = '<polygon points="56,116 64,120 56,124" fill="#e74c3c"/><polygon points="72,116 64,120 72,124" fill="#e74c3c"/><circle cx="64" cy="120" r="3" fill="#c0392b"/>';
    } else if (acc === 'orb') {
      accSvg = '<circle cx="114" cy="100" r="12" fill="#00d2d3" opacity="0.85"/><circle cx="111" cy="97" r="4" fill="#fff" opacity="0.9"/>';
    }

    let mouthSvg = `<rect x="60" y="96" width="8" height="5" rx="2" fill="${dark}"/>`;
    if (shape === 'frog') {
      mouthSvg = `<path d="M 46 94 Q 64 104 82 94" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    } else if (shape === 'duck' || shape === 'pig') {
      mouthSvg = '';
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="100%" height="100%">
<g>
${feetSvg}
${earsSvg}
<rect x="9" y="31" width="110" height="105" ${bodyRadius} fill="${color}" stroke="${dark}" stroke-width="8"/>
${shellSvg}
<rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>
<rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>
${eyesSvg}
${mouthSvg}
${snoutSvg}
${accSvg}
</g>
</svg>`;
  }

  function getAvailableCharacters() {
    const list = [];

    // 1. Check imported NFT companions
    let items = [];
    try {
      const bridge = window.PetAndroid || window.TinyFrensDesktop;
      items = bridge?.getTurtle ? JSON.parse(bridge.getTurtle()).items || [] : JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]');
    } catch {}

    const validCompanions = (Array.isArray(items) ? items : []).filter(
      nft => nft && nft.active !== false && Date.now() < (nft.validUntil || Infinity) * 1000
    );

    for (const c of validCompanions) {
      const adapter = c.companion?.adapter || '';
      let collName = 'Imported NFT';
      if (adapter === 'hood-turtles-v1') collName = 'Hood Turtles';
      else if (adapter === 'tinyfrens-robots-v1') collName = 'Robots v1';
      else if (adapter === 'nubs-v1') collName = 'The Nubs';
      else if (adapter === 'bots-computers-v1') collName = 'Bots Computers';

      const spriteUrl = c.companion?.idle || c.companion?.frames?.[0] || c.image || '';
      const charId = window.TinyFrensCompanionKey ? window.TinyFrensCompanionKey(c) : `nft-${c.chainId}-${c.tokenId}`;

      list.push({
        id: charId,
        type: 'nft',
        name: c.name || `Token #${c.tokenId}`,
        collection: collName,
        tokenId: c.tokenId,
        chainId: c.chainId,
        spriteUrl: spriteUrl,
        frames: c.companion?.frames && c.companion.frames.length > 0 ? c.companion.frames : [spriteUrl],
        frameMs: c.companion?.frameMs || 160,
        nft: c
      });
    }

    // 2. Base Fren pet
    const s = petState();
    const species = getSpeciesName(s.shape);
    list.push({
      id: 'fren-pet',
      type: 'pet',
      name: s.name || 'Your fren',
      collection: `TinyFrens ${species}`,
      species: species,
      pet: s
    });

    return list;
  }

  function buildSnapModal() {
    if (document.getElementById('snapModal')) return;

    modal = document.createElement('div');
    modal.id = 'snapModal';
    modal.className = 'snap-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="snap-container" role="dialog" aria-modal="true" aria-labelledby="snapModalTitle">
        <header class="snap-modal-header">
          <div class="snap-header-left">
            <span class="snap-badge-tag">🟣 Farcaster Snap 2.0</span>
            <h2 id="snapModalTitle" class="snap-header-title">Generate In-Feed Card</h2>
          </div>
          <button type="button" id="snapModalCloseBtn" class="snap-modal-close" aria-label="Close Snap generator">✕</button>
        </header>

        <div class="snap-body">
          <div id="snapCharPicker" class="snap-char-picker" aria-label="Choose companion to snap"></div>

          <!-- The Simulated Farcaster Snap Card -->
          <div class="snap-card" id="snapCard">
            <div class="snap-card-top">
              <h3 id="snapCardName" class="snap-card-name">Your fren</h3>
              <span id="snapCardBadge" class="snap-card-badge">Pocket Pet</span>
            </div>

            <div class="snap-hero-frame" id="snapHeroFrame">
              <img id="snapHeroImg" class="snap-hero-sprite" alt="Companion Sprite" hidden>
              <div id="snapHeroSvgWrap" class="snap-hero-svg-wrap"></div>
              <div id="snapReactionAnchor"></div>
            </div>

            <p id="snapStatusText" class="snap-status-text">Your 1:1 on-chain & floating desktop companion. Pet, feed & play in-feed!</p>

            <div class="snap-action-btns">
              <button type="button" id="snapActionPet" class="snap-action-btn" data-action="pet">
                <span aria-hidden="true">💖</span>Pet
              </button>
              <button type="button" id="snapActionFeed" class="snap-action-btn" data-action="feed">
                <span aria-hidden="true">🍓</span>Feed
              </button>
              <button type="button" id="snapActionPlay" class="snap-action-btn" data-action="play">
                <span aria-hidden="true">🎾</span>Play
              </button>
            </div>

            <button type="button" id="snapCardMiniApp" class="snap-miniapp-btn">
              Open TinyFrens Mini App 🐾
            </button>
          </div>

          <!-- Sharing & Export Toolbar -->
          <div class="snap-export-bar">
            <button type="button" id="snapCastPrimaryBtn" class="snap-cast-primary-btn">
              🟣 Cast on Farcaster
            </button>
            <div class="snap-export-subrow">
              <button type="button" id="snapCopyLinkBtn" class="snap-sub-btn">
                📋 Copy Link
              </button>
              <button type="button" id="snapSaveCardBtn" class="snap-sub-btn">
                💾 Save Card Image
              </button>
            </div>
            <p class="snap-footer-help">Posts an interactive Snap to Farcaster. Anyone in your feed can pet, feed, and play with your fren!</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    setupEvents();
  }

  function getSnapUrl(char) {
    const origin = window.location.origin;
    if (char.type === 'nft' && char.tokenId) {
      return `${origin}/snap?nft=${char.tokenId}`;
    }
    const name = encodeURIComponent(char.name || 'TinyFren');
    const species = encodeURIComponent(char.species || 'Fren');
    return `${origin}/snap?name=${name}&species=${species}`;
  }

  function renderCharacter(char) {
    activeChar = char;
    clearInterval(spriteCycleTimer);

    const nameEl = document.getElementById('snapCardName');
    const badgeEl = document.getElementById('snapCardBadge');
    const imgEl = document.getElementById('snapHeroImg');
    const svgWrapEl = document.getElementById('snapHeroSvgWrap');
    const statusEl = document.getElementById('snapStatusText');

    if (nameEl) nameEl.textContent = char.name;
    if (badgeEl) badgeEl.textContent = char.collection;
    if (statusEl) statusEl.textContent = `Your 1:1 on-chain & floating desktop companion. Pet, feed & play with ${char.name} in-feed!`;

    if (char.type === 'nft') {
      if (svgWrapEl) svgWrapEl.hidden = true;
      if (imgEl) {
        imgEl.hidden = false;
        imgEl.src = char.spriteUrl || char.frames[0] || '';
        // If animated frames exist, cycle through them
        if (char.frames && char.frames.length > 1) {
          currentFrameIdx = 0;
          spriteCycleTimer = setInterval(() => {
            currentFrameIdx = (currentFrameIdx + 1) % char.frames.length;
            imgEl.src = char.frames[currentFrameIdx];
          }, char.frameMs || 160);
        }
      }
    } else {
      if (imgEl) imgEl.hidden = true;
      if (svgWrapEl) {
        svgWrapEl.hidden = false;
        svgWrapEl.innerHTML = generatePetSvg(char.pet || petState());
      }
    }

    // Update active pill in character picker
    const pills = document.querySelectorAll('.snap-char-pill');
    pills.forEach(pill => {
      pill.classList.toggle('active', pill.dataset.charId === char.id);
    });
  }

  function triggerSnapReaction(action) {
    if (!activeChar) return;
    const heroFrame = document.getElementById('snapHeroFrame');
    const targetGraphic = activeChar.type === 'nft'
      ? document.getElementById('snapHeroImg')
      : document.getElementById('snapHeroSvgWrap');
    const statusEl = document.getElementById('snapStatusText');

    clearTimeout(animTimer);
    if (targetGraphic) {
      targetGraphic.classList.remove('snap-hero-anim-pet', 'snap-hero-anim-feed', 'snap-hero-anim-play');
      void targetGraphic.offsetWidth; // Force reflow
    }

    let emoji = '💖';
    let statusMsg = '';

    if (action === 'pet') {
      emoji = '💖';
      statusMsg = `You petted ${activeChar.name}! They did a little wiggle 💖`;
      if (targetGraphic) targetGraphic.classList.add('snap-hero-anim-pet');
    } else if (action === 'feed') {
      emoji = '🍓';
      statusMsg = `You fed ${activeChar.name} a fresh strawberry 🍓! Nom nom.`;
      if (targetGraphic) targetGraphic.classList.add('snap-hero-anim-feed');
    } else if (action === 'play') {
      emoji = '🎾';
      statusMsg = `You played ball with ${activeChar.name} 🎾! Joy is at 100%!`;
      if (targetGraphic) targetGraphic.classList.add('snap-hero-anim-play');
    }

    // Spawn floating emoji burst
    if (heroFrame) {
      const burst = document.createElement('div');
      burst.className = 'snap-reaction-burst';
      burst.textContent = emoji;
      burst.style.left = `${35 + Math.random() * 30}%`;
      burst.style.top = `${30 + Math.random() * 20}%`;
      heroFrame.appendChild(burst);
      setTimeout(() => burst.remove(), 900);
    }

    // Update status text with highlight glow
    if (statusEl) {
      statusEl.textContent = statusMsg;
      statusEl.classList.remove('snap-status-highlight');
      void statusEl.offsetWidth;
      statusEl.classList.add('snap-status-highlight');
    }

    // Confetti effect if supported
    if (window.TinyFrensEffects?.confetti) {
      try { window.TinyFrensEffects.confetti(); } catch {}
    }

    // Local pet care reward if active character is Fren pet
    if (activeChar.type === 'pet' && typeof act === 'function' && typeof read === 'function') {
      try { act(read(), action); } catch {}
    }

    // Non-blocking ping to relay server if available
    const base = String(window.TINYFRENS_SERVER || '').replace(/\/$/, '');
    if (base) {
      try {
        fetch(`${base}/api/snap/interact?action=${encodeURIComponent(action)}&name=${encodeURIComponent(activeChar.name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }).catch(() => {});
      } catch {}
    }

    animTimer = setTimeout(() => {
      if (targetGraphic) {
        targetGraphic.classList.remove('snap-hero-anim-pet', 'snap-hero-anim-feed', 'snap-hero-anim-play');
      }
    }, 1000);
  }

  function castOnFarcaster() {
    if (!activeChar) return;
    const snapUrl = getSnapUrl(activeChar);
    const text = `Check out my @tinyfrens companion ${activeChar.name} (${activeChar.collection})! 🐾✨\n\nInteract with the snap below to Pet, Feed, or Play! #TinyFrens #FarcasterSnap`;

    if (window.TinyFrensFC?.composeCast) {
      window.TinyFrensFC.composeCast({ text, embeds: [snapUrl] });
      return;
    }

    // Fallback: direct Warpcast compose link
    const params = new URLSearchParams();
    params.set('text', text);
    params.append('embeds[]', snapUrl);
    window.open(`https://warpcast.com/~/compose?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }

  async function copySnapLink() {
    if (!activeChar) return;
    const snapUrl = getSnapUrl(activeChar);
    const btn = document.getElementById('snapCopyLinkBtn');
    try {
      await navigator.clipboard.writeText(snapUrl);
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = 'Copied! ✓';
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
      }
    } catch {
      prompt('Copy your Farcaster Snap link:', snapUrl);
    }
  }

  async function saveCardImage() {
    if (!activeChar) return;
    const btn = document.getElementById('snapSaveCardBtn');
    const origText = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = 'Rendering…';

    try {
      const width = 600;
      const height = 740;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // 1. Card Background & Gradient border
      ctx.fillStyle = '#17142a';
      ctx.fillRect(0, 0, width, height);

      // Gradient accent header stripe
      const grad = ctx.createLinearGradient(0, 0, width, 0);
      grad.addColorStop(0, '#a474f1');
      grad.addColorStop(0.5, '#66c7d2');
      grad.addColorStop(1, '#ffb95e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, 6);

      // Inner card panel
      ctx.fillStyle = '#201b3a';
      ctx.strokeStyle = '#4a386d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(24, 24, width - 48, height - 48, 24);
      ctx.fill();
      ctx.stroke();

      // Top header in card
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
      ctx.fillText('TinyFrens', 48, 66);

      // Farcaster Snap 2.0 Badge
      ctx.fillStyle = '#855DCD';
      ctx.beginPath();
      ctx.roundRect(width - 230, 44, 180, 32, 16);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
      ctx.fillText('🟣 Farcaster Snap 2.0', width - 216, 65);

      // 2. Hero Box
      const heroY = 96;
      const heroW = width - 96;
      const heroH = 260;
      ctx.fillStyle = '#19152b';
      ctx.strokeStyle = '#3d2f5a';
      ctx.beginPath();
      ctx.roundRect(48, heroY, heroW, heroH, 16);
      ctx.fill();
      ctx.stroke();

      // Spotlight glow
      const spot = ctx.createRadialGradient(width / 2, heroY + heroH / 2, 20, width / 2, heroY + heroH / 2, 160);
      spot.addColorStop(0, 'rgba(164, 116, 241, 0.25)');
      spot.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = spot;
      ctx.fillRect(48, heroY, heroW, heroH);

      // Render character into Hero Box
      const renderCharImg = new Image();
      let imgSrc = '';

      if (activeChar.type === 'nft') {
        imgSrc = activeChar.spriteUrl || activeChar.frames[0];
      } else {
        const svgStr = generatePetSvg(activeChar.pet || petState());
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
        imgSrc = URL.createObjectURL(blob);
      }

      await new Promise((resolve) => {
        renderCharImg.onload = () => {
          const charSize = 160;
          const cx = (width - charSize) / 2;
          const cy = heroY + (heroH - charSize) / 2;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(renderCharImg, cx, cy, charSize, charSize);
          if (activeChar.type === 'pet') URL.revokeObjectURL(imgSrc);
          resolve();
        };
        renderCharImg.onerror = resolve;
        renderCharImg.src = imgSrc;
      });

      // 3. Name & Collection labels
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
      ctx.fillText(activeChar.name, 48, 400);

      ctx.fillStyle = '#c8b1fa';
      ctx.font = '600 16px system-ui, -apple-system, sans-serif';
      ctx.fillText(activeChar.collection, 48, 428);

      // 4. Status message box
      ctx.fillStyle = '#171329';
      ctx.strokeStyle = '#382b54';
      ctx.beginPath();
      ctx.roundRect(48, 452, heroW, 58, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#d5c4f7';
      ctx.font = '500 14px system-ui, -apple-system, sans-serif';
      const statusText = `Your 1:1 on-chain & floating desktop companion. Pet, feed & play with ${activeChar.name} in-feed!`;
      ctx.fillText(statusText, 64, 488);

      // 5. Interactive action pills
      const pillW = (heroW - 16) / 3;
      const actions = [
        { label: '💖 Pet', x: 48 },
        { label: '🍓 Feed', x: 48 + pillW + 8 },
        { label: '🎾 Play', x: 48 + (pillW + 8) * 2 }
      ];
      ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
      for (const a of actions) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.strokeStyle = '#4a386d';
        ctx.beginPath();
        ctx.roundRect(a.x, 526, pillW, 46, 12);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(a.label, a.x + (pillW / 2) - 26, 555);
      }

      // 6. Mini App Launch Button
      ctx.fillStyle = '#855DCD';
      ctx.beginPath();
      ctx.roundRect(48, 586, heroW, 48, 12);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
      ctx.fillText('Open TinyFrens Mini App 🐾', 48 + (heroW / 2) - 105, 617);

      // 7. Footer Tagline
      ctx.fillStyle = '#9b8eb6';
      ctx.font = '12px system-ui, -apple-system, sans-serif';
      ctx.fillText('tinyfrens.lol · Built for Farcaster & Warpcast', (width / 2) - 110, 680);

      // 8. Download PNG
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      const cleanName = (activeChar.name || 'fren').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      a.href = dataUrl;
      a.download = `tinyfren-${cleanName}-farcaster-snap.png`;
      a.click();
    } catch (err) {
      console.warn('Snap card download failed:', err);
    } finally {
      if (btn) btn.innerHTML = origText;
    }
  }

  function setupEvents() {
    const closeBtn = document.getElementById('snapModalCloseBtn');
    if (closeBtn) closeBtn.onclick = closeSnapModal;

    // Action buttons inside card
    const petBtn = document.getElementById('snapActionPet');
    if (petBtn) petBtn.onclick = () => triggerSnapReaction('pet');

    const feedBtn = document.getElementById('snapActionFeed');
    if (feedBtn) feedBtn.onclick = () => triggerSnapReaction('feed');

    const playBtn = document.getElementById('snapActionPlay');
    if (playBtn) playBtn.onclick = () => triggerSnapReaction('play');

    const miniAppBtn = document.getElementById('snapCardMiniApp');
    if (miniAppBtn) {
      miniAppBtn.onclick = () => {
        closeSnapModal();
        if (typeof window.showScreen === 'function') window.showScreen('pet');
      };
    }

    // Export Toolbar
    const castBtn = document.getElementById('snapCastPrimaryBtn');
    if (castBtn) castBtn.onclick = castOnFarcaster;

    const copyBtn = document.getElementById('snapCopyLinkBtn');
    if (copyBtn) copyBtn.onclick = copySnapLink;

    const saveBtn = document.getElementById('snapSaveCardBtn');
    if (saveBtn) saveBtn.onclick = saveCardImage;

    // Close on backdrop tap
    modal.onclick = (e) => {
      if (e.target === modal) closeSnapModal();
    };

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.hidden) closeSnapModal();
    });
  }

  function openSnapModal() {
    buildSnapModal();
    const characters = getAvailableCharacters();
    if (!characters.length) return;

    // Setup character picker pills
    const picker = document.getElementById('snapCharPicker');
    if (picker) {
      picker.innerHTML = '';
      characters.forEach((char, idx) => {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `snap-char-pill${idx === 0 ? ' active' : ''}`;
        pill.dataset.charId = char.id;
        pill.textContent = char.name;
        pill.onclick = () => renderCharacter(char);
        picker.appendChild(pill);
      });
    }

    // Default to the first character (active NFT if exists, otherwise pet Fren)
    renderCharacter(characters[0]);

    if (modal) modal.hidden = false;
  }

  function closeSnapModal() {
    clearInterval(spriteCycleTimer);
    clearTimeout(animTimer);
    if (modal) modal.hidden = true;
  }

  function initSnapButton() {
    buildSnapModal();
    const btn = document.getElementById('snapPet');
    if (btn) {
      btn.onclick = openSnapModal;
    }
  }

  window.TinyFrensSnap = {
    open: openSnapModal,
    close: closeSnapModal,
    getCharacters: getAvailableCharacters,
    triggerAction: triggerSnapReaction,
    getSnapUrl: getSnapUrl
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSnapButton);
  } else {
    initSnapButton();
  }
})();
