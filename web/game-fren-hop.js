/*
 * Fren Hop: your fren runs on its own. Tap to hop over rocks and cacti, stay low under bees.
 *
 * The round model (create/step) is pure and runs under Node for tests
 * (scripts/test-fren-hop.cjs). mount() is browser-only and draws it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.TinyFrensFrenHop = api;
    if (root.TinyFrensGames) root.TinyFrensGames.register(api.game);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WIDTH = 360, HEIGHT = 480, GROUND = 400;
  var FREN_X = 84, FREN_W = 72, FREN_H = 82, HIT_HALF = 20, HIT_H = 60;
  var GRAVITY = 2200, JUMP_V = 760, JUMP_BUFFER = 0.12;
  var START_LIVES = 3, HURT_TIME = 1.1, BERRY_POINTS = 3, DISTANCE_PER_POINT = 100;
  var OBSTACLES = {
    rock: { emoji: '🪨', w: 28, h: 26, top: GROUND - 26 },
    cactus: { emoji: '🌵', w: 24, h: 44, top: GROUND - 44 },
    bee: { emoji: '🐝', w: 26, h: 22, top: GROUND - 100 }
  };
  var BERRY = { emoji: '🍓', w: 24, h: 24, top: GROUND - 150 };

  function create(rand) {
    return {
      rand: rand || Math.random,
      time: 0, distance: 0, berries: 0, score: 0, lives: START_LIVES, over: false,
      fren: { y: 0, vy: 0, hurt: 0 }, jumpBuffer: 0,
      obstacles: [], nextId: 1, nextSpawn: 420
    };
  }

  function speed(time) { return Math.min(520, 220 + time * 6); }
  function minGap(v) { return v * 0.8 + 60; }
  function onGround(s) { return s.fren.y <= 0 && s.fren.vy <= 0; }

  function pickKind(s) {
    var r = s.rand();
    if (s.time > 10 && r < 0.22) return 'bee';
    return s.rand() < 0.5 ? 'rock' : 'cactus';
  }

  function spawn(s, v) {
    var kind = pickKind(s);
    var gap = minGap(v) * (1 + s.rand() * 0.9);
    if (kind === 'bee') gap *= 1.3;
    s.obstacles.push({ id: s.nextId++, kind: kind, x: WIDTH + 40 });
    if (s.rand() < 0.35) s.obstacles.push({ id: s.nextId++, kind: 'berry', x: WIDTH + 40 + gap / 2 });
    s.nextSpawn = gap;
  }

  function rectOf(item) {
    var spec = item.kind === 'berry' ? BERRY : OBSTACLES[item.kind];
    return { left: item.x - spec.w / 2, right: item.x + spec.w / 2, top: spec.top, bottom: spec.top + spec.h };
  }

  function touches(s, item) {
    var r = rectOf(item);
    var bottom = GROUND - s.fren.y, top = bottom - HIT_H;
    return r.left < FREN_X + HIT_HALF && r.right > FREN_X - HIT_HALF && r.top < bottom && r.bottom > top;
  }

  // Advances the round by dt seconds. input.jump is true on the frame a hop is pressed.
  // Returns events for the renderer: jump, land, hit, berry, over.
  function step(s, dt, input) {
    var events = [];
    if (s.over) return events;
    dt = Math.max(0, Math.min(dt, 0.05));
    s.time += dt;
    var v = speed(s.time);
    s.distance += v * dt;

    if (input && input.jump) s.jumpBuffer = JUMP_BUFFER;
    else s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
    if (s.jumpBuffer > 0 && onGround(s)) { s.fren.vy = JUMP_V; s.jumpBuffer = 0; events.push({ type: 'jump' }); }
    if (s.fren.y > 0 || s.fren.vy > 0) {
      s.fren.vy -= GRAVITY * dt;
      s.fren.y += s.fren.vy * dt;
      if (s.fren.y <= 0) { s.fren.y = 0; s.fren.vy = 0; events.push({ type: 'land' }); }
    }
    s.fren.hurt = Math.max(0, s.fren.hurt - dt);

    s.nextSpawn -= v * dt;
    if (s.nextSpawn <= 0) spawn(s, v);

    var kept = [];
    for (var i = 0; i < s.obstacles.length; i++) {
      var item = s.obstacles[i];
      item.x -= v * dt;
      if (touches(s, item)) {
        if (item.kind === 'berry') { s.berries++; events.push({ type: 'berry', x: item.x, y: BERRY.top }); continue; }
        if (!s.fren.hurt) { s.lives--; s.fren.hurt = HURT_TIME; events.push({ type: 'hit', kind: item.kind, x: item.x, y: OBSTACLES[item.kind].top }); }
      }
      if (item.x > -40) kept.push(item);
    }
    s.obstacles = kept;
    s.score = Math.floor(s.distance / DISTANCE_PER_POINT) + s.berries * BERRY_POINTS;
    if (s.lives <= 0) { s.over = true; events.push({ type: 'over', score: s.score }); }
    return events;
  }

  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  // Browser only. The hub supplies a verified animated NFT and the care bridge.
  function mount(host, api) {
    var area = document.createElement('div');
    area.className = 'game-area';
    area.tabIndex = 0;
    area.setAttribute('aria-label', 'Fren Hop play area. Tap, click, or press Space to hop.');
    var canvas = document.createElement('canvas');
    var frenBox = document.createElement('div');
    frenBox.className = 'game-fren';
    var fren = api.makeFren();
    frenBox.append(fren);
    area.append(canvas, frenBox);
    host.append(area);

    var ctx = canvas.getContext('2d');
    var state = create();
    var scale = 1, raf = 0, last = 0, paused = false, jumpPressed = false;
    var popups = [], hintFor = 2.5;

    function resize() {
      var rect = area.getBoundingClientRect();
      if (!rect.width) return;
      scale = rect.width / WIDTH;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.width * HEIGHT / WIDTH * dpr);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      frenBox.style.width = FREN_W * scale + 'px';
      frenBox.style.height = FREN_H * scale + 'px';
      fren.style.setProperty('--pet-scale', String(FREN_W * scale / 140));
    }
    var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(area); else window.addEventListener('resize', resize);

    area.addEventListener('pointerdown', function (e) { e.preventDefault(); jumpPressed = true; area.focus({ preventScroll: true }); });
    area.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      if (k !== ' ' && k !== 'arrowup' && k !== 'w') return;
      e.preventDefault();
      if (!e.repeat) jumpPressed = true;
    });

    function react(events) {
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.type === 'berry') popups.push({ text: '+' + BERRY_POINTS, x: e.x, y: e.y, life: 0.7, color: '#ffe38a' });
        else if (e.type === 'hit') {
          popups.push({ text: 'oof!', x: FREN_X, y: GROUND - FREN_H - 20, life: 0.8, color: '#ff8fa3' });
          area.classList.remove('game-ouch'); void area.offsetWidth; area.classList.add('game-ouch');
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = '#2a2147';
      ctx.fillRect(0, GROUND, WIDTH, HEIGHT - GROUND);
      ctx.fillStyle = '#4a3b68';
      ctx.fillRect(0, GROUND, WIDTH, 3);
      ctx.fillStyle = '#3c3155';
      var offset = state.distance % 40;
      for (var x = -offset; x < WIDTH; x += 40) ctx.fillRect(x, GROUND + 18, 14, 3);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '28px ' + EMOJI_FONT;
      for (var i = 0; i < state.obstacles.length; i++) {
        var item = state.obstacles[i];
        var r = rectOf(item);
        ctx.fillText(item.kind === 'berry' ? BERRY.emoji : OBSTACLES[item.kind].emoji, item.x, (r.top + r.bottom) / 2);
      }
      ctx.font = 'bold 18px system-ui,sans-serif';
      for (var p = 0; p < popups.length; p++) {
        ctx.globalAlpha = Math.max(0, popups[p].life / 0.7);
        ctx.fillStyle = popups[p].color;
        ctx.fillText(popups[p].text, popups[p].x, popups[p].y);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f7f1ff';
      ctx.textAlign = 'left';
      ctx.font = 'bold 20px system-ui,sans-serif';
      ctx.fillText('★ ' + state.score, 14, 22);
      ctx.textAlign = 'right';
      ctx.font = '18px ' + EMOJI_FONT;
      var hearts = '';
      for (var h = 0; h < START_LIVES; h++) hearts += h < state.lives ? '💜' : '🖤';
      ctx.fillText(hearts, WIDTH - 12, 22);
      if (hintFor > 0) {
        ctx.globalAlpha = Math.min(1, hintFor);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#cbb6ff';
        ctx.font = 'bold 15px system-ui,sans-serif';
        ctx.fillText('Tap or press Space to hop.', WIDTH / 2, HEIGHT / 2 - 80);
        ctx.fillText('Stay low under the bees 🐝', WIDTH / 2, HEIGHT / 2 - 56);
        ctx.globalAlpha = 1;
      }
      frenBox.style.transform = 'translate(' + (FREN_X - FREN_W / 2) * scale + 'px,' + (GROUND - state.fren.y - FREN_H) * scale + 'px)';
      frenBox.style.opacity = state.fren.hurt && Math.floor(state.fren.hurt * 10) % 2 ? '0.35' : '';
    }

    function frame(now) {
      raf = 0;
      if (paused) return;
      var dt = last ? (now - last) / 1000 : 0;
      last = now;
      var events = step(state, dt, { jump: jumpPressed });
      jumpPressed = false;
      try { api.updatePlayer(state.time * 1000, onGround(state) && !state.over, 1); }
      catch (error) { paused = true; api.onError(error); return; }
      react(events);
      hintFor = Math.max(0, hintFor - dt);
      for (var i = popups.length - 1; i >= 0; i--) { popups[i].life -= dt; popups[i].y -= 40 * dt; if (popups[i].life <= 0) popups.splice(i, 1); }
      draw();
      if (state.over) { frenBox.style.opacity = ''; api.onEnd({ score: state.score, duration: state.time }); return; }
      raf = requestAnimationFrame(frame);
    }

    resize();
    area.focus({ preventScroll: true });
    raf = requestAnimationFrame(frame);

    return {
      pause: function () { paused = true; if (raf) cancelAnimationFrame(raf); raf = 0; },
      resume: function () {
        if (!paused || state.over) return;
        paused = false; last = 0; jumpPressed = false;
        raf = requestAnimationFrame(frame);
      },
      destroy: function () {
        paused = true;
        if (raf) cancelAnimationFrame(raf);
        if (observer) observer.disconnect(); else window.removeEventListener('resize', resize);
        area.remove();
      }
    };
  }

  return {
    WIDTH: WIDTH, HEIGHT: HEIGHT, GROUND: GROUND, FREN_X: FREN_X, HIT_HALF: HIT_HALF, HIT_H: HIT_H,
    OBSTACLES: OBSTACLES, BERRY: BERRY, BERRY_POINTS: BERRY_POINTS, START_LIVES: START_LIVES,
    HURT_TIME: HURT_TIME, DISTANCE_PER_POINT: DISTANCE_PER_POINT,
    create: create, step: step, speed: speed, minGap: minGap,
    game: {
      id: 'fren-hop',
      title: 'Fren Hop',
      emoji: '🐾',
      blurb: 'Tap to hop over rocks. Stay low under the bees.',
      careHint: 'Hop for 15 seconds to earn the usual Play care effect.',
      mount: mount
    }
  };
});
