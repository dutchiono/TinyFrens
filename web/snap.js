'use strict';
/**
 * TinyFrens Farcaster Snap & AR Camera Viewfinder Engine
 * Allows users to snap their pet in their current pose / real-world setting,
 * and compose casts instantly to Farcaster / Warpcast.
 */
(() => {
  let stream = null;
  let facingMode = 'environment';
  let isDragging = false;
  let petX = 0;
  let petY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let capturedBlob = null;
  let capturedDataUrl = null;

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
      dog: 'Puppy Dog', bear: 'Teddy Bear', frog: 'Frog', turtle: 'Turtle'
    };
    return map[s] || 'Fren';
  }

  function generatePetSvg(s, action) {
    const color = s.color || '#a474f1';
    const dark = '#4b2d77';
    const shape = s.shape || 'cat';
    const expr = s.expression || 'happy';
    const acc = s.accessory || 'none';

    let bodyRadius = 'rx="38" ry="32"';
    let earsSvg = '';
    let shellSvg = '';

    if (shape === 'cat') {
      earsSvg = `<polygon points="20,40 36,4 52,40" fill="${color}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
<polygon points="76,40 92,4 108,40" fill="${color}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>`;
    } else if (shape === 'blob') {
      bodyRadius = 'rx="48" ry="40"';
    } else if (shape === 'robot') {
      earsSvg = `<rect x="60" y="8" width="8" height="24" fill="${dark}"/>
<circle cx="64" cy="8" r="6" fill="${color}" stroke="${dark}" stroke-width="3"/>`;
      bodyRadius = 'rx="8" ry="8"';
    } else if (shape === 'bunny') {
      earsSvg = `<rect x="26" y="2" width="20" height="50" rx="10" fill="${color}" stroke="${dark}" stroke-width="7"/>
<rect x="82" y="2" width="20" height="50" rx="10" fill="${color}" stroke="${dark}" stroke-width="7"/>`;
    } else if (shape === 'dog') {
      earsSvg = `<rect x="6" y="38" width="24" height="42" rx="10" transform="rotate(-25 6 38)" fill="${color}" stroke="${dark}" stroke-width="7"/>
<rect x="98" y="28" width="24" height="42" rx="10" transform="rotate(25 98 28)" fill="${color}" stroke="${dark}" stroke-width="7"/>`;
    } else if (shape === 'bear') {
      earsSvg = `<circle cx="28" cy="30" r="16" fill="${color}" stroke="${dark}" stroke-width="7"/>
<circle cx="100" cy="30" r="16" fill="${color}" stroke="${dark}" stroke-width="7"/>`;
    } else if (shape === 'frog') {
      earsSvg = `<circle cx="34" cy="32" r="16" fill="${color}" stroke="${dark}" stroke-width="7"/>
<circle cx="94" cy="32" r="16" fill="${color}" stroke="${dark}" stroke-width="7"/>
<circle cx="34" cy="32" r="5" fill="#fff"/>
<circle cx="94" cy="32" r="5" fill="#fff"/>
<circle cx="34" cy="32" r="2.5" fill="${dark}"/>
<circle cx="94" cy="32" r="2.5" fill="${dark}"/>`;
      bodyRadius = 'rx="46" ry="38"';
    } else if (shape === 'turtle') {
      bodyRadius = 'rx="48" ry="40"';
      shellSvg = `<circle cx="64" cy="83" r="30" fill="none" stroke="${dark}" stroke-width="4" stroke-dasharray="8 6"/>`;
    }

    let eyesSvg = `<rect x="32" y="66" width="12" height="20" rx="3" fill="${dark}"/>
<rect x="84" y="66" width="12" height="20" rx="3" fill="${dark}"/>
<circle cx="35" cy="70" r="2.5" fill="#fff"/>
<circle cx="87" cy="70" r="2.5" fill="#fff"/>`;

    if (expr === 'wink') {
      eyesSvg = `<rect x="32" y="66" width="12" height="20" rx="3" fill="${dark}"/>
<circle cx="35" cy="70" r="2.5" fill="#fff"/>
<path d="M 82 76 Q 90 70 98 76" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    } else if (expr === 'shades') {
      eyesSvg = `<rect x="24" y="64" width="36" height="18" rx="3" fill="#111"/>
<rect x="68" y="64" width="36" height="18" rx="3" fill="#111"/>
<rect x="56" y="68" width="16" height="4" fill="#111"/>
<line x1="28" y1="67" x2="52" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>
<line x1="72" y1="67" x2="96" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>`;
    } else if (expr === 'star_eyes') {
      eyesSvg = `<polygon points="38,62 41,71 50,71 43,76 46,85 38,80 30,85 33,76 26,71 35,71" fill="#ffd700"/>
<polygon points="90,62 93,71 102,71 95,76 98,85 90,80 82,85 85,76 78,71 87,71" fill="#ffd700"/>`;
    } else if (expr === 'sleepy' || action === 'sleep') {
      eyesSvg = `<line x1="28" y1="76" x2="44" y2="76" stroke="${dark}" stroke-width="4" stroke-linecap="round"/>
<line x1="80" y1="76" x2="96" y2="76" stroke="${dark}" stroke-width="4" stroke-linecap="round"/>
<text x="100" y="50" font-family="sans-serif" font-weight="bold" font-size="16" fill="#c8b1fa">zZ</text>`;
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

    let actionAnim = '';
    if (action === 'dance') {
      actionAnim = '<animateTransform attributeName="transform" type="rotate" values="-10 64 74; 10 64 74; -10 64 74" dur="0.5s" repeatCount="indefinite"/>';
    } else if (action === 'wave') {
      actionAnim = '<animateTransform attributeName="transform" type="rotate" values="0 64 74; -8 64 74; 0 64 74" dur="0.6s" repeatCount="indefinite"/>';
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="100%" height="100%">
<g>
${actionAnim}
<rect x="25" y="132" width="29" height="12" rx="4" fill="${dark}"/>
<rect x="74" y="132" width="29" height="12" rx="4" fill="${dark}"/>
${earsSvg}
<rect x="9" y="31" width="110" height="105" ${bodyRadius} fill="${color}" stroke="${dark}" stroke-width="8"/>
${shellSvg}
<rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>
<rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>
${eyesSvg}
<rect x="60" y="96" width="8" height="5" rx="2" fill="${dark}"/>
${accSvg}
</g>
</svg>`;
  }

  function buildSnapModal() {
    if (document.getElementById('snapModal')) return;

    const modal = document.createElement('div');
    modal.id = 'snapModal';
    modal.className = 'snap-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="snap-viewfinder">
        <video id="snapVideo" class="snap-video" autoplay playsinline muted></video>
        <div id="snapStudioBg" class="snap-studio-bg" hidden></div>
        <div id="snapPetOverlay" class="snap-pet-overlay">
          <div id="snapPetSvgHost" class="snap-pet-svg-host"></div>
        </div>
        <div class="snap-flash" id="snapFlash"></div>
        
        <header class="snap-header">
          <span class="snap-title">📸 TinyFrens Snap</span>
          <button type="button" id="snapCloseBtn" class="snap-icon-btn" aria-label="Close">✕</button>
        </header>

        <footer class="snap-controls">
          <div class="snap-poses">
            <button type="button" class="snap-pose-btn active" data-pose="idle">Idle</button>
            <button type="button" class="snap-pose-btn" data-pose="dance">Dance</button>
            <button type="button" class="snap-pose-btn" data-pose="wave">Wave</button>
            <button type="button" class="snap-pose-btn" data-pose="sleep">Nap</button>
          </div>
          <div class="snap-shutter-row">
            <button type="button" id="snapFlipBtn" class="snap-icon-btn" title="Flip camera">🔄</button>
            <button type="button" id="snapShutterBtn" class="snap-shutter-trigger" aria-label="Take snap">
              <span class="snap-shutter-ring"></span>
            </button>
            <button type="button" id="snapModeBtn" class="snap-icon-btn" title="Toggle camera / studio">🎨</button>
          </div>
          <p class="snap-hint">Drag your fren to place them in your world!</p>
        </footer>
      </div>

      <div id="snapPreviewModal" class="snap-preview-modal" hidden>
        <div class="snap-preview-card">
          <canvas id="snapCanvas" hidden></canvas>
          <img id="snapPreviewImg" class="snap-preview-img" alt="Captured Snap">
          <div class="snap-preview-actions">
            <button type="button" id="snapCastBtn" class="snap-cast-btn">🟣 Cast on Farcaster</button>
            <div class="actions" style="margin:8px 0 0">
              <button type="button" id="snapDownloadBtn" class="secondary">💾 Save</button>
              <button type="button" id="snapCopyLinkBtn" class="secondary">📋 Copy Link</button>
              <button type="button" id="snapRetakeBtn" class="secondary">🔄 Retake</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    setupModalEvents();
  }

  let currentPose = 'idle';
  let studioMode = false;

  function updatePetSvgInOverlay() {
    const s = petState();
    const svgStr = generatePetSvg(s, currentPose);
    const host = document.getElementById('snapPetSvgHost');
    if (host) host.innerHTML = svgStr;
  }

  async function startCamera() {
    stopCamera();
    const video = document.getElementById('snapVideo');
    const studio = document.getElementById('snapStudioBg');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      if (video) {
        video.srcObject = stream;
        video.hidden = false;
      }
      if (studio) studio.hidden = true;
      studioMode = false;
    } catch (err) {
      console.warn('Camera inaccessible, switching to studio mode:', err);
      if (video) video.hidden = true;
      if (studio) studio.hidden = false;
      studioMode = true;
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  }

  function openSnapStudio() {
    buildSnapModal();
    const modal = document.getElementById('snapModal');
    const preview = document.getElementById('snapPreviewModal');
    if (modal) modal.hidden = false;
    if (preview) preview.hidden = true;

    // Reset pet position to center
    const overlay = document.getElementById('snapPetOverlay');
    if (overlay) {
      overlay.style.transform = 'translate(-50%, -50%)';
      petX = 0;
      petY = 0;
    }

    currentPose = 'idle';
    updatePetSvgInOverlay();
    startCamera();
  }

  function closeSnapStudio() {
    const modal = document.getElementById('snapModal');
    if (modal) modal.hidden = true;
    stopCamera();
  }

  function captureSnapshot() {
    const flash = document.getElementById('snapFlash');
    if (flash) {
      flash.classList.add('active');
      setTimeout(() => flash.classList.remove('active'), 250);
    }

    const video = document.getElementById('snapVideo');
    const canvas = document.getElementById('snapCanvas');
    const overlay = document.getElementById('snapPetOverlay');
    const ctx = canvas.getContext('2d');

    const width = 720;
    const height = 960;
    canvas.width = width;
    canvas.height = height;

    // 1. Draw Background (Video or Studio Gradient)
    if (!studioMode && video && video.videoWidth) {
      // Draw video scaled to cover canvas
      const vRatio = video.videoWidth / video.videoHeight;
      const cRatio = width / height;
      let sx, sy, sWidth, sHeight;
      if (vRatio > cRatio) {
        sHeight = video.videoHeight;
        sWidth = sHeight * cRatio;
        sx = (video.videoWidth - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = video.videoWidth;
        sHeight = sWidth / cRatio;
        sx = 0;
        sy = (video.videoHeight - sHeight) / 2;
      }
      ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height);
    } else {
      // Studio gradient
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#2d1b4e');
      grad.addColorStop(0.5, '#17142a');
      grad.addColorStop(1, '#0f0c1b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Subtle studio grid/spotlight
      const spot = ctx.createRadialGradient(width / 2, height / 2, 40, width / 2, height / 2, 380);
      spot.addColorStop(0, '#a474f133');
      spot.addColorStop(1, '#00000000');
      ctx.fillStyle = spot;
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Render Pet SVG onto an off-screen image
    const s = petState();
    const svgStr = generatePetSvg(s, currentPose);
    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      // Compute coordinates relative to canvas
      const petRenderSize = 240;
      // Convert relative pet position
      const centerX = width / 2 + petX * 1.5;
      const centerY = height / 2 + petY * 1.5 - 40;

      // Soft shadow under pet
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(centerX, centerY + petRenderSize / 2 + 10, petRenderSize * 0.35, 14, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fill();
      ctx.restore();

      // Draw Pet
      ctx.drawImage(img, centerX - petRenderSize / 2, centerY - petRenderSize / 2, petRenderSize, petRenderSize * (148 / 128));
      URL.revokeObjectURL(url);

      // 3. Draw Sleek Polaroid / Card Footer
      const footerH = 110;
      ctx.fillStyle = 'rgba(23, 20, 42, 0.92)';
      ctx.fillRect(0, height - footerH, width, footerH);

      // Gradient accent line
      const lineGrad = ctx.createLinearGradient(0, 0, width, 0);
      lineGrad.addColorStop(0, '#a474f1');
      lineGrad.addColorStop(0.5, '#66c7d2');
      lineGrad.addColorStop(1, '#ffb95e');
      ctx.fillStyle = lineGrad;
      ctx.fillRect(0, height - footerH, width, 4);

      // Pet Name & Species
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px -apple-system, system-ui, sans-serif';
      ctx.fillText(s.name || 'TinyFren', 24, height - footerH + 42);

      ctx.fillStyle = '#c8b1fa';
      ctx.font = '500 18px -apple-system, system-ui, sans-serif';
      const speciesName = getSpeciesName(s.shape);
      const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      ctx.fillText(`${speciesName} · ${today}`, 24, height - footerH + 74);

      // Farcaster Snap Badge on right
      ctx.fillStyle = '#855DCD'; // Farcaster purple
      ctx.beginPath();
      ctx.roundRect(width - 190, height - footerH + 28, 166, 44, 22);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px -apple-system, system-ui, sans-serif';
      ctx.fillText('🐾 Farcaster Snap', width - 176, height - footerH + 56);

      // Save Data URL & Show Preview
      capturedDataUrl = canvas.toDataURL('image/png');
      canvas.toBlob((blob) => { capturedBlob = blob; }, 'image/png');

      const previewImg = document.getElementById('snapPreviewImg');
      if (previewImg) previewImg.src = capturedDataUrl;

      const previewModal = document.getElementById('snapPreviewModal');
      if (previewModal) previewModal.hidden = false;
    };
    img.src = url;
  }

  function setupModalEvents() {
    const closeBtn = document.getElementById('snapCloseBtn');
    if (closeBtn) closeBtn.onclick = closeSnapStudio;

    const shutterBtn = document.getElementById('snapShutterBtn');
    if (shutterBtn) shutterBtn.onclick = captureSnapshot;

    const flipBtn = document.getElementById('snapFlipBtn');
    if (flipBtn) {
      flipBtn.onclick = () => {
        facingMode = (facingMode === 'environment') ? 'user' : 'environment';
        startCamera();
      };
    }

    const modeBtn = document.getElementById('snapModeBtn');
    if (modeBtn) {
      modeBtn.onclick = () => {
        studioMode = !studioMode;
        const video = document.getElementById('snapVideo');
        const studio = document.getElementById('snapStudioBg');
        if (studioMode) {
          stopCamera();
          if (video) video.hidden = true;
          if (studio) studio.hidden = false;
        } else {
          startCamera();
        }
      };
    }

    // Pose Buttons
    const poseBtns = document.querySelectorAll('.snap-pose-btn');
    poseBtns.forEach(btn => {
      btn.onclick = () => {
        poseBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPose = btn.dataset.pose || 'idle';
        updatePetSvgInOverlay();
      };
    });

    // Pet Dragging on Viewfinder
    const overlay = document.getElementById('snapPetOverlay');
    const viewfinder = document.querySelector('.snap-viewfinder');

    function onPointerDown(e) {
      isDragging = true;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      dragStartX = clientX - petX;
      dragStartY = clientY - petY;
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      petX = clientX - dragStartX;
      petY = clientY - dragStartY;
      if (overlay) {
        overlay.style.transform = `translate(calc(-50% + ${petX}px), calc(-50% + ${petY}px))`;
      }
    }

    function onPointerUp() {
      isDragging = false;
    }

    if (overlay) {
      overlay.addEventListener('mousedown', onPointerDown);
      overlay.addEventListener('touchstart', onPointerDown, { passive: true });
    }
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: true });
    window.addEventListener('mouseup', onPointerUp);
    window.addEventListener('touchend', onPointerUp);

    // Preview Actions
    const castBtn = document.getElementById('snapCastBtn');
    if (castBtn) {
      castBtn.onclick = () => {
        const s = petState();
        const species = getSpeciesName(s.shape);
        const text = `Snapped my @tinyfrens companion in real life! 🐾✨\n\nMeet ${s.name || 'my fren'}, a ${species} feeling ${currentPose}.\n\n#TinyFrens #FarcasterSnap`;
        const snapUrl = window.location.origin + '/';
        window.TinyFrensFC?.composeCast?.({ text, embeds: [snapUrl] });
      };
    }

    const downloadBtn = document.getElementById('snapDownloadBtn');
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        if (!capturedDataUrl) return;
        const a = document.createElement('a');
        a.href = capturedDataUrl;
        a.download = `tinyfren-snap-${Date.now()}.png`;
        a.click();
      };
    }

    const copyBtn = document.getElementById('snapCopyLinkBtn');
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const shareUrl = window.location.origin + '/';
        try {
          await navigator.clipboard.writeText(shareUrl);
          copyBtn.textContent = 'Copied! ✓';
          setTimeout(() => { copyBtn.textContent = '📋 Copy Link'; }, 2000);
        } catch {
          prompt('Copy this link:', shareUrl);
        }
      };
    }

    const retakeBtn = document.getElementById('snapRetakeBtn');
    if (retakeBtn) {
      retakeBtn.onclick = () => {
        const preview = document.getElementById('snapPreviewModal');
        if (preview) preview.hidden = true;
      };
    }
  }

  // Hook into main UI
  function initSnapButton() {
    buildSnapModal();

    // Check if snap button already exists
    if (document.getElementById('snapPet')) {
      document.getElementById('snapPet').onclick = openSnapStudio;
      return;
    }

    const littleActions = document.querySelector('.little-actions');
    if (littleActions) {
      const btn = document.createElement('button');
      btn.id = 'snapPet';
      btn.type = 'button';
      btn.className = 'secondary snap-action-btn';
      btn.innerHTML = '<span aria-hidden="true">📸</span>Snap!';
      btn.title = 'Snap your fren with camera & share to Farcaster';
      btn.onclick = openSnapStudio;
      littleActions.appendChild(btn);
    }
  }

  window.TinyFrensSnap = {
    open: openSnapStudio,
    close: closeSnapStudio,
    capture: captureSnapshot
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSnapButton);
  } else {
    initSnapButton();
  }
})();
