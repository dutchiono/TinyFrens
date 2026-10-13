(() => {
  const lane = document.querySelector('.tf-header-frens');
  if (!lane) return;
  const source = document.currentScript.src;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let robot, sprites = [], last = 0, clock = 0;
  function selected() {
    try {
      const bridge = window.PetAndroid || window.TinyFrensDesktop;
      const items = bridge?.getTurtle ? JSON.parse(bridge.getTurtle()).items || [] : JSON.parse(localStorage.getItem('tinyfrens-companions') || '[]');
      return items.find(n => n.active !== false && n.validUntil * 1000 > Date.now() && n.companion?.frames?.length);
    } catch { return null; }
  }
  function draw() {
    if (!robot) return;
    const own = selected();
    const rigs = [robot];
    if (own && !(own.chainId === 8453 && own.originalAddress?.toLowerCase() === '0xd745d8005a1ad8f783b97bf55e0d0e6a920ea8ff' && Number(own.tokenId) === 1)) rigs.push(own.companion);
    lane.replaceChildren();
    for (let i=0;i<3;i++){const ledge=document.createElement('span');ledge.className='tf-header-ledge';lane.append(ledge);}
    sprites = rigs.map(rig => {
      const img = document.createElement('img'); img.className = 'tf-header-fren'; img.alt = ''; img.src = rig.idle || rig.frames[0]; lane.append(img);
      return {img, rig, x:0, direction:1, level:0, nextHop:clock + 2500 + Math.random()*4000, hop:null};
    });
  }
  function tick(time) {
    requestAnimationFrame(tick);
    if (document.hidden) { last = time; return; }
    if (time - last < 80) return;
    const elapsed = Math.min(time - last, 150); last = time;
    if (!reduced.matches) clock += elapsed;
    const width = lane.clientWidth, size = sprites[0]?.img.clientWidth || 38;
    const travel = Math.max(0, width - size);
    for (const [i, sprite] of sprites.entries()) {
      const gap = Math.min(44, width * .07);
      const platforms = [[0,width*.32-gap/2],[width*.32+gap/2,width*.67-gap/2],[width*.67+gap/2,width]];
      const rise = Math.max(0, lane.clientHeight - 58);
      lane.querySelectorAll('.tf-header-ledge').forEach((ledge,j)=>{ledge.style.left=platforms[j][0]+'px';ledge.style.width=(platforms[j][1]-platforms[j][0])+'px';});
      const platform = platforms.find(p=>sprite.x>=p[0] && sprite.x<=p[1]-size) || platforms[0];
      const min = sprite.level ? platform[0] : 0, max = sprite.level ? Math.max(platform[0],platform[1]-size) : travel;
      let y = sprite.level ? -rise : 0;
      if (reduced.matches) { sprite.x = i * (size + 10); y = 0; }
      else if (sprite.hop) {
        const progress = Math.min(1, (clock - sprite.hop.start) / 650);
        y = sprite.hop.from + (sprite.hop.to - sprite.hop.from) * progress - Math.sin(progress * Math.PI) * 15;
        if(sprite.hop.toX!=null)sprite.x=sprite.hop.fromX+(sprite.hop.toX-sprite.hop.fromX)*progress;
        if (progress === 1) { sprite.level = sprite.hop.land; sprite.hop = null; sprite.nextHop = clock + 4000 + Math.random() * 7000; }
      } else {
        sprite.x += elapsed * .045 * sprite.direction;
        if (sprite.level && (sprite.x >= max || sprite.x <= min)) {
          sprite.x=Math.max(min,Math.min(max,sprite.x));
          const index=platforms.indexOf(platform),next=platforms[index+sprite.direction];
          if(next){const fail=Math.random()<.12;sprite.hop={start:clock,from:y,to:fail?0:-rise,land:fail?0:1,fromX:sprite.x,toX:sprite.direction>0?next[0]:Math.max(next[0],next[1]-size)};}
          else sprite.direction*=-1;
        } else {
          if (sprite.x >= max) { sprite.x = max; sprite.direction = -1; }
          if (sprite.x <= min) { sprite.x = min; sprite.direction = 1; }
        }
        if (!sprite.hop && clock >= sprite.nextHop && platforms.some(p=>sprite.x>=p[0] && sprite.x<=p[1]-size) && rise > 15) {
          sprite.hop = {start:clock, from:y, to:sprite.level ? 0 : -rise,land:sprite.level?0:1};
        }
      }
      sprite.img.style.transform = `translate(${Math.min(sprite.x, travel)}px,${y}px) scaleX(${sprite.direction})`;
      const frame = reduced.matches ? sprite.rig.idle || sprite.rig.frames[0] : sprite.rig.frames[Math.floor(clock / (sprite.rig.frameMs || 140)) % sprite.rig.frames.length];
      if (sprite.img.getAttribute('src') !== frame) sprite.img.src = frame;
    }
  }
  fetch(new URL('header-robot.json', source)).then(r => { if (!r.ok) throw Error('Header robot unavailable'); return r.json(); }).then(data => { robot = data; draw(); requestAnimationFrame(tick); }).catch(() => {});
  for (const event of ['tinyfrens-wallet-link-changed', 'tinyfrens-account-synced', 'storage']) window.addEventListener(event, draw);
})();
