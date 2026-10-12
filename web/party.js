'use strict';
(() => {
  const status = $('partyStatus'), stage = $('partyStage'), leave = $('leaveParty'), code = $('privatePartyCode');
  const inspectModal = $('partyInspectModal'), closeInspectBtn = $('closePartyInspect');
  let active = null;
  const memberNodes = new Map(); // id -> { el, x, y, facing, nextMove, member }
  let inspectTarget = null;
  let roamInterval = null;
  const saved = 'tinyfrens-party-code';
  try { code.value = localStorage.getItem(saved) || ''; } catch {}

  const VALID_SHAPES = ['cat','blob','robot','bunny','dog','bear','frog','turtle'];
  const VALID_EXPRS = ['happy','wink','shades','star_eyes','sleepy','loving','laser','grin'];
  const VALID_ACCS = ['none','party_hat','crown','straw_hat','halo','beanie','strawberry','orb','bubble','bow_tie'];

  function petProfile() {
    const s = read();
    const shape = s.shape === 'mascot' ? 'robot' : VALID_SHAPES.includes(s.shape) ? s.shape : 'cat';
    const expr = VALID_EXPRS.includes(s.expression) ? s.expression : 'happy';
    const acc = VALID_ACCS.includes(s.accessory) ? s.accessory : 'none';
    const tokenId = (typeof s.tokenId === 'number' && s.tokenId >= 1 && s.tokenId <= 2664) ? s.tokenId : null;
    return {
      name: cleanName(s.name) || 'A fren',
      shape,
      color: /^#[0-9a-f]{6}$/i.test(s.color || '') ? s.color : '#a474f1',
      expression: expr,
      accessory: acc,
      tokenId
    };
  }

  function applyPetTraits(sprite, pet) {
    if (!sprite || !pet) return;
    const shape = pet.shape === 'mascot' ? 'robot' : VALID_SHAPES.includes(pet.shape) ? pet.shape : 'cat';
    sprite.dataset.shape = shape;
    sprite.dataset.expression = VALID_EXPRS.includes(pet.expression) ? pet.expression : 'happy';
    sprite.dataset.accessory = VALID_ACCS.includes(pet.accessory) ? pet.accessory : 'none';
    sprite.style.setProperty('--pet-color', pet.color || '#a474f1');
  }

  function createFrenElement(member) {
    const wrap = document.createElement('div');
    wrap.className = 'party-fren';
    wrap.dataset.memberId = member.id;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', (cleanName(member.pet?.name) || 'A fren') + ' · Tap to inspect');

    const reaction = document.createElement('div');
    reaction.className = 'party-reaction-bubble';

    const spriteWrap = document.createElement('div');
    spriteWrap.className = 'party-sprite-wrapper';

    const sprite = $('pet').cloneNode(true);
    sprite.removeAttribute('id');
    applyPetTraits(sprite, member.pet);
    sprite.dataset.action = 'idle';
    spriteWrap.append(sprite);

    const tag = document.createElement('div');
    tag.className = 'party-fren-tag';

    if (member.pet?.tokenId) {
      const badge = document.createElement('span');
      badge.className = 'nft-badge';
      badge.textContent = '✨ #' + member.pet.tokenId;
      tag.append(badge);
    }

    const name = document.createElement('strong');
    name.textContent = cleanName(member.pet?.name) || 'A fren';
    tag.append(name);

    wrap.append(reaction, spriteWrap, tag);

    wrap.onclick = (e) => {
      e.stopPropagation();
      openInspect(member);
    };
    wrap.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openInspect(member);
      }
    };

    return wrap;
  }

  function updateFrenElement(el, member) {
    const sprite = el.querySelector('.pet');
    applyPetTraits(sprite, member.pet);
    const tag = el.querySelector('.party-fren-tag');
    if (tag) {
      tag.replaceChildren();
      if (member.pet?.tokenId) {
        const badge = document.createElement('span');
        badge.className = 'nft-badge';
        badge.textContent = '✨ #' + member.pet.tokenId;
        tag.append(badge);
      }
      const name = document.createElement('strong');
      name.textContent = cleanName(member.pet?.name) || 'A fren';
      tag.append(name);
    }
  }

  function startRoaming() {
    if (roamInterval) return;
    roamInterval = setInterval(() => {
      const now = Date.now();
      memberNodes.forEach((item) => {
        if (now < item.nextMove) return;
        item.nextMove = now + 3000 + Math.random() * 3500;
        const tx = Math.max(10, Math.min(90, 14 + Math.random() * 72));
        const ty = Math.max(22, Math.min(84, 26 + Math.random() * 54));
        const spriteWrap = item.el.querySelector('.party-sprite-wrapper');
        if (spriteWrap) {
          if (tx < item.x - 2) spriteWrap.style.transform = 'scaleX(-1)';
          else if (tx > item.x + 2) spriteWrap.style.transform = 'scaleX(1)';
        }
        item.x = tx;
        item.y = ty;
        item.el.style.left = tx + '%';
        item.el.style.top = ty + '%';

        if (Math.random() < 0.35) {
          const sprite = item.el.querySelector('.pet');
          if (sprite && !sprite.dataset.action) {
            sprite.dataset.action = Math.random() < 0.5 ? 'wave' : 'dance';
            setTimeout(() => { if (sprite) sprite.dataset.action = ''; }, 2400);
          }
        }
      });
    }, 1000);
  }

  function stopRoaming() {
    if (roamInterval) {
      clearInterval(roamInterval);
      roamInterval = null;
    }
  }

  function triggerReaction(targetId, action) {
    const item = memberNodes.get(targetId);
    if (!item) return;
    const bubble = item.el.querySelector('.party-reaction-bubble');
    const sprite = item.el.querySelector('.pet');
    if (bubble) {
      const emojis = {
        berry: '🍓',
        pet: '💖',
        heart: '💖',
        wave: '👋',
        dance: '🎵'
      };
      bubble.textContent = emojis[action] || '✨';
      bubble.classList.remove('animate');
      void bubble.offsetWidth;
      bubble.classList.add('animate');
    }
    if (sprite) {
      const act = action === 'berry' ? 'eat' : action === 'wave' ? 'wave' : 'dance';
      sprite.dataset.action = act;
      setTimeout(() => { if (sprite) sprite.dataset.action = ''; }, 2200);
    }
  }

  function openInspect(member) {
    inspectTarget = member;
    if (!inspectModal) return;
    const avatarHost = $('inspectAvatar');
    if (avatarHost) {
      avatarHost.replaceChildren();
      const sprite = $('pet').cloneNode(true);
      sprite.removeAttribute('id');
      applyPetTraits(sprite, member.pet);
      sprite.dataset.action = 'wave';
      avatarHost.append(sprite);
    }

    const nameEl = $('inspectName');
    if (nameEl) nameEl.textContent = cleanName(member.pet?.name) || 'Visiting Fren';

    const badgeHost = $('inspectBadge');
    if (badgeHost) {
      badgeHost.replaceChildren();
      if (member.pet?.tokenId) {
        const badge = document.createElement('span');
        badge.className = 'nft-badge-lg';
        badge.textContent = '✨ On-Chain TinyFren #' + member.pet.tokenId;
        badgeHost.append(badge);
      }
    }

    const traitsHost = $('inspectTraits');
    if (traitsHost) {
      traitsHost.replaceChildren();
      const chips = [
        { label: 'Species', val: member.pet?.shape || 'cat' },
        { label: 'Expression', val: (member.pet?.expression || 'happy').replace('_', ' ') },
        { label: 'Accessory', val: (member.pet?.accessory || 'none').replace('_', ' ') }
      ];
      chips.forEach(c => {
        const chip = document.createElement('span');
        chip.className = 'inspect-trait-chip';
        chip.innerHTML = '<b>' + c.label + ':</b> ' + c.val;
        traitsHost.append(chip);
      });
    }

    inspectModal.hidden = false;
  }

  function closeInspect() {
    inspectTarget = null;
    if (inspectModal) inspectModal.hidden = true;
  }

  function sendPartyAction(action) {
    if (!inspectTarget) return;
    const api = window.TinyFrensFriends;
    if (api && api.connected()) {
      api.send({ type: 'party-action', action, target: inspectTarget.id });
      triggerReaction(inspectTarget.id, action);
      if (window.tinyFrensEffects?.respond) {
        window.tinyFrensEffects.respond(action === 'berry' ? 'feed' : action);
      }
    }
    closeInspect();
  }

  $('inspectActionBerry')?.addEventListener('click', () => sendPartyAction('berry'));
  $('inspectActionPet')?.addEventListener('click', () => sendPartyAction('pet'));
  $('inspectActionWave')?.addEventListener('click', () => sendPartyAction('wave'));
  closeInspectBtn?.addEventListener('click', closeInspect);
  inspectModal?.addEventListener('click', (e) => {
    if (e.target === inspectModal) closeInspect();
  });

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
    status.textContent = room === 'public' ? 'Entering the Public Plaza...' : 'Joining private room ' + roomCode + '...';
  }

  function joinChat(platform, chatId, label) {
    const api = window.TinyFrensFriends;
    if (!api) { status.textContent = 'Party mode needs the TinyFrens server.'; return; }
    if (!api.connected()) {
      api.connect?.();
      status.textContent = 'Connecting to the TinyFrens server. Try again in a moment.';
      return;
    }
    active = {room: 'chat', platform, chatId};
    leave.disabled = false;
    api.send({type:'party-join', room:'chat', platform, chatId, pet: petProfile()});
    status.textContent = 'Joining ' + (label || (platform === 'discord' ? 'this Discord channel' : 'this Telegram group')) + '...';
  }

  function draw(data) {
    if (data.type !== 'party-state') return;
    if (!data.members?.length || data.room === 'none') {
      active = null;
      leave.disabled = true;
      status.textContent = 'Plaza is quiet right now. Join to step outside!';
      memberNodes.forEach(item => item.el.remove());
      memberNodes.clear();
      stopRoaming();
      closeInspect();
      if (window.PetAndroid?.setGuests) {
        try { window.PetAndroid.setGuests('[]'); } catch {}
      }
      return;
    }
    leave.disabled = false;
    const label = data.room === 'chat'
      ? (data.platform === 'discord' ? 'Discord channel' : 'Telegram group') + ' · '
      : (data.room === 'public' ? 'Public Plaza' : 'Private room ' + data.code) + ' · ';
    status.textContent = label + data.members.length + ' fren' + (data.members.length === 1 ? '' : 's') + ' roaming';

    const currentIds = new Set(data.members.map(m => m.id));
    for (const [id, item] of memberNodes.entries()) {
      if (!currentIds.has(id)) {
        item.el.classList.add('leaving');
        setTimeout(() => item.el.remove(), 350);
        memberNodes.delete(id);
      }
    }

    data.members.slice(0, 80).forEach((member, index) => {
      let item = memberNodes.get(member.id);
      if (!item) {
        const el = createFrenElement(member);
        const angle = index * 2.399, radius = 18 + (index % 7) * 6;
        const startX = Math.max(12, Math.min(88, 50 + Math.cos(angle) * radius));
        const startY = Math.max(24, Math.min(84, 52 + Math.sin(angle) * Math.min(radius, 32)));
        el.style.left = startX + '%';
        el.style.top = startY + '%';
        stage.append(el);
        item = {
          el,
          x: startX,
          y: startY,
          facing: 1,
          nextMove: Date.now() + 1500 + Math.random() * 3000,
          member
        };
        memberNodes.set(member.id, item);
      } else {
        item.member = member;
        updateFrenElement(item.el, member);
      }
    });

    startRoaming();

    // Cross-Device Android Floating Guests (up to 2 nearest visitors)
    const myCode = window.TinyFrensFriends?.identity?.()?.id;
    const visitors = data.members.filter(m => m.id !== myCode);
    const guests = visitors.slice(0, 2).map(m => ({
      name: m.pet?.name || 'A fren',
      shape: m.pet?.shape === 'mascot' ? 'robot' : m.pet?.shape || 'cat',
      color: m.pet?.color || '#a474f1',
      expression: m.pet?.expression || 'happy',
      accessory: m.pet?.accessory || 'none',
      tokenId: m.pet?.tokenId || null
    }));
    if (window.PetAndroid?.setGuests) {
      try { window.PetAndroid.setGuests(JSON.stringify(guests)); } catch (e) {
        console.warn('Failed to set Android guests:', e);
      }
    }
  }

  function handleMessage(data) {
    if (data.type === 'party-state') draw(data);
    else if (data.type === 'party-action') {
      const targetId = data.target || data.sender;
      triggerReaction(targetId, data.action);
    }
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
    active = null; leave.disabled = true;
    memberNodes.forEach(item => item.el.remove());
    memberNodes.clear();
    stopRoaming();
    closeInspect();
    status.textContent = 'Returned home. Plaza mode is off.';
    if (window.PetAndroid?.setGuests) {
      try { window.PetAndroid.setGuests('[]'); } catch {}
    }
  };

  // Space switcher hooks
  $('spaceHome')?.addEventListener('click', () => window.showScreen('pet'));
  $('spacePlaza')?.addEventListener('click', () => {
    window.showScreen('party');
    if (!active) join('public');
  });
  $('visitPlazaQuick')?.addEventListener('click', () => {
    window.showScreen('party');
    if (!active) join('public');
  });

  window.TinyFrensFriends?.on(handleMessage);
  window.addEventListener('pet-profile-changed', () => {
    const api = window.TinyFrensFriends;
    if (active && api && api.connected()) {
      const base = {pet: petProfile()};
      if (active.room === 'chat') api.send({type:'party-join', room:'chat', platform:active.platform, chatId:active.chatId, ...base});
      else api.send({type:'party-join', room:active.room, code:active.code, ...base});
    }
  });

  // Public API
  window.TinyFrensParty = {
    join,
    joinChat,
    joinPublic: () => join('public'),
    joinPrivate: (c) => join('private', c),
    getActive: () => active
  };
})();
