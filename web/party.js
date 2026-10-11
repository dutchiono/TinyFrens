'use strict';
(() => {
  const status = $('partyStatus'), stage = $('partyStage'), leave = $('leaveParty'), code = $('privatePartyCode');
  let active = null;
  const saved = 'tinyfrens-party-code';
  try { code.value = localStorage.getItem(saved) || ''; } catch {}
  function petProfile() {
    const s = read();
    return {
      name: cleanName(s.name) || 'A fren',
      shape: s.shape === 'mascot' ? 'robot' : ['cat','blob','robot','bunny','dog','bear','frog','turtle'].includes(s.shape) ? s.shape : 'cat',
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#a474f1'
    };
  }
  function join(room, roomCode='') {
    const api = window.TinyFrensFriends;
    if (!api) { status.textContent = 'Party mode needs the TinyFrens server.'; return; }
    if (!api.connected()) {
      api.connect?.();
      status.textContent = 'Connecting to the TinyFrens server. Try again in a moment.';
      return;
    }
    active = {room, code: roomCode};
    leave.disabled = false;
    api.send({type:'party-join', room, code: roomCode, pet: petProfile()});
    status.textContent = room === 'public' ? 'Joining the public room...' : 'Joining private room ' + roomCode + '...';
  }
  function draw(data) {
    if (data.type !== 'party-state') return;
    stage.replaceChildren();
    if (!data.members?.length || data.room === 'none') {
      active = null; leave.disabled = true; status.textContent = 'Party mode is off.'; return;
    }
    leave.disabled = false;
    status.textContent = (data.room === 'public' ? 'Public room' : 'Private room ' + data.code) + ' · ' + data.members.length + ' fren' + (data.members.length === 1 ? '' : 's');
    data.members.slice(0,80).forEach((member, index) => {
      const wrap = document.createElement('div');
      wrap.className = 'party-fren';
      const angle = index * 2.399, radius = 18 + (index % 7) * 5;
      const x = 50 + Math.cos(angle) * radius, y = 52 + Math.sin(angle) * Math.min(radius, 34);
      wrap.style.left = Math.max(8, Math.min(92, x)) + '%';
      wrap.style.top = Math.max(18, Math.min(88, y)) + '%';
      const sprite = $('pet').cloneNode(true);
      sprite.removeAttribute('id');
      sprite.dataset.shape = member.pet.shape === 'mascot' ? 'robot' : member.pet.shape;
      sprite.dataset.action = index % 3 === 0 ? 'wave' : index % 3 === 1 ? 'dance' : 'idle';
      sprite.style.setProperty('--pet-color', member.pet.color || '#a474f1');
      const name = document.createElement('strong');
      name.textContent = cleanName(member.pet.name) || 'A fren';
      wrap.append(sprite, name);
      stage.append(wrap);
    });
  }
  $('joinPublicParty').onclick = () => join('public');
  $('privatePartyForm').onsubmit = event => {
    event.preventDefault();
    const roomCode = code.value.replace(/[^A-Za-z0-9-]/g,'').toUpperCase().slice(0,24);
    if (roomCode.length < 3) { status.textContent = 'Enter a private room code.'; code.focus(); return; }
    code.value = roomCode;
    try { localStorage.setItem(saved, roomCode); } catch {}
    join('private', roomCode);
  };
  leave.onclick = () => {
    window.TinyFrensFriends?.send({type:'party-leave'});
    active = null; leave.disabled = true; stage.replaceChildren(); status.textContent = 'Party mode is off.';
  };
  window.TinyFrensFriends?.on(draw);
  window.addEventListener('pet-profile-changed', () => {
    if (active && window.TinyFrensFriends?.connected()) window.TinyFrensFriends.send({type:'party-join', room:active.room, code:active.code, pet:petProfile()});
  });
})();
