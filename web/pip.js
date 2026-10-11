'use strict';
(() => {
  if (native) return; // Android uses the transparent native overlay.
  const panel = document.createElement('section');
  panel.className = 'overlay';
  panel.id = 'video-pet';
  panel.innerHTML = '<h2>Take your fren along</h2><p>A little video companion for your other apps.</p><video id="pipVideo" controls playsinline webkit-playsinline loop preload="auto" aria-label="Animated TinyFrens pet"></video><div class="actions"><button id="floatPet">Float pet</button><button id="stopFloat" class="secondary">Stop video</button></div><p id="pipStatus" role="status">Tap Float pet. If prompted, play the video first, then tap again.</p><p class="pip-note">PiP uses a video window and the closest preset colour. Feed, play and customize back here.</p><details><summary>Install on iPhone</summary><p>Open this page in Safari → Share → Add to Home Screen → Add. No payment or account needed. If floating is unavailable in the installed app, <a id="safariPet" target="_blank" rel="noopener">open the pet in Safari</a> and try there.</p></details>';
  $('floatingVideoHost').append(panel);
  const video = document.getElementById('pipVideo');
  const button = document.getElementById('floatPet');
  const status = document.getElementById('pipStatus');
  const palette = {purple:'#a474f1',cyan:'#66c7d2',amber:'#ffb95e',mint:'#82eba1',pink:'#ee8fb9',blue:'#83a9ff'};
  const rgb = value => [1,3,5].map(i => parseInt(value.slice(i,i+2),16));
  function selectClip() {
    const state = read();
    const shape = ['cat','blob','robot','mascot'].includes(state.shape) ? state.shape : 'cat';
    const colour = /^#[0-9a-f]{6}$/i.test(state.color||'') ? state.color : '#a474f1';
    const wanted = rgb(colour);
    const closest = Object.keys(palette).sort((a,b) => {
      const distance = name => rgb(palette[name]).reduce((sum,n,i) => sum+(n-wanted[i])**2,0);
      return distance(a)-distance(b);
    })[0];
    const source = shape==='mascot' ? 'pip/mascot-purple.mp4' : 'pip/'+shape+'-'+closest+'.mp4';
    if (video.getAttribute('src') !== source) {video.pause();video.src=source;video.load();}
  }
  selectClip();
  for (const id of ['saveStyle','resetStyle']) document.getElementById(id)?.addEventListener('click',selectClip);
  document.getElementById('safariPet').href = location.protocol === 'https:' ? location.href : 'https://dutchiono.github.io/TinyFrens/web/';
  video.addEventListener('error',()=>{status.textContent='Video could not load. Check your connection and reload this page.';button.disabled=false;});
  video.addEventListener('webkitpresentationmodechanged',()=>{if(video.webkitPresentationMode==='picture-in-picture')status.textContent='Your fren is floating. You can switch apps. Return here for care.';});
  video.addEventListener('enterpictureinpicture',()=>{status.textContent='Your fren is floating. Switch apps when you’re ready.';});
  video.addEventListener('leavepictureinpicture',()=>{status.textContent='Back home! Tap Float pet to float again.';});
  function fallback() {
    if (typeof video.webkitEnterFullscreen === 'function') {
      try {video.webkitEnterFullscreen();status.textContent='Use the video’s Picture in Picture control, or switch apps from full-screen playback. Availability depends on your iPhone settings.';return;} catch (_) {}
    }
    status.textContent='Floating video is unavailable here. Try Safari on iPhone, or use the video’s controls. Your pet still works in this page.';
  }
  button.onclick = () => {
    // Keep PiP invocation within this tap; do not await network work and lose user activation.
    video.muted=false;
    const playback=video.play();
    playback?.catch(()=>{status.textContent='Tap Play on the video, then tap Float pet again.';});
    if(video.readyState<2){status.textContent='Loading the video. Once it starts, tap Float pet again.';return;}
    if(typeof video.webkitSetPresentationMode==='function' && video.webkitSupportsPresentationMode?.('picture-in-picture')) {
      try {video.webkitSetPresentationMode('picture-in-picture');return;}catch(_){fallback();return;}
    }
    if(document.pictureInPictureEnabled && typeof video.requestPictureInPicture==='function') {
      video.requestPictureInPicture().catch(()=>{status.textContent='PiP could not start. Tap Play, then try Float pet again, or use the video’s own controls.';});return;
    }
    fallback();
  };
  document.getElementById('stopFloat').onclick=()=>{
    if(video.webkitPresentationMode==='picture-in-picture')video.webkitSetPresentationMode('inline');
    else if(document.pictureInPictureElement===video)document.exitPictureInPicture().catch(()=>{});
    video.pause();status.textContent='Video stopped. Your pet’s care data stays saved.';
  };
  // Replace the old nonfunctional web-overlay controls with the working video route.
  $('platform').textContent='Your fren can come along in a floating video.';
  $('start').textContent='Float pet video';$('start').hidden=false;$('start').onclick=()=>{window.showScreen?.('pet');panel.scrollIntoView({behavior:'smooth',block:'center'});button.click();};
  $('stop').hidden=true;
})();
