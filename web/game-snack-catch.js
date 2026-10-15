/*
 * Snack Catch: slide your fren left and right to catch falling snacks and dodge socks.
 *
 * The round model (create/step) is pure and runs under Node for tests
 * (scripts/test-snack-catch.cjs). mount() is browser-only and draws it.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.TinyFrensSnackCatch = api;
    if (root.TinyFrensGames) root.TinyFrensGames.register(api.game);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WIDTH = 360, HEIGHT = 480;
  var FREN_REACH = 34, ITEM_RADIUS = 14, FREN_W = 72, FREN_H = 82;
  var CATCH_TOP = HEIGHT - 92, CATCH_BOTTOM = HEIGHT - 44;
  var FREN_SPEED = 520, START_LIVES = 3;
  var ITEMS = {
    berry: { emoji: '🍓', points: 1, good: true },
    cookie: { emoji: '🍪', points: 2, good: true },
    star: { emoji: '⭐', points: 5, good: true },
    sock: { emoji: '🧦', points: 0, good: false }
  };

  function create(rand) {
    return {
      rand: rand || Math.random,
      time: 0, score: 0, lives: START_LIVES, caught: 0, over: false,
      fren: { x: WIDTH / 2 }, items: [], nextId: 1, spawnIn: 0.6
    };
  }

  function spawnInterval(time) { return Math.max(0.38, 1.05 - time * 0.012); }
  function fallSpeed(time) { return Math.min(380, 130 + time * 4); }
  function sockChance(time) { return Math.min(0.38, 0.16 + time * 0.004); }

  function pickKind(s) {
    var r = s.rand();
    if (r < sockChance(s.time)) return 'sock';
    r = s.rand();
    if (r < 0.06) return 'star';
    if (r < 0.26) return 'cookie';
    return 'berry';
  }

  function spawn(s) {
    s.items.push({
      id: s.nextId++,
      kind: pickKind(s),
      x: ITEM_RADIUS + s.rand() * (WIDTH - ITEM_RADIUS * 2),
      y: -ITEM_RADIUS,
      vy: fallSpeed(s.time) * (0.85 + s.rand() * 0.3)
    });
  }

  function moveFren(s, dt, input) {
    var target = s.fren.x;
    if (input && typeof input.targetX === 'number') target = input.targetX;
    else if (input && input.dir) target = s.fren.x + input.dir * FREN_SPEED * dt;
    target = Math.max(FREN_REACH, Math.min(WIDTH - FREN_REACH, target));
    var step = FREN_SPEED * dt, delta = target - s.fren.x;
    s.fren.x += Math.max(-step, Math.min(step, delta));
  }

  // Advances the round by dt seconds. Returns events for the renderer: catch, ouch, over.
  function step(s, dt, input) {
    var events = [];
    if (s.over) return events;
    dt = Math.max(0, Math.min(dt, 0.05));
    s.time += dt;
    moveFren(s, dt, input);
    s.spawnIn -= dt;
    while (s.spawnIn <= 0) { spawn(s); s.spawnIn += spawnInterval(s.time); }
    var kept = [];
    for (var i = 0; i < s.items.length; i++) {
      var item = s.items[i];
      item.y += item.vy * dt;
      var inZone = item.y >= CATCH_TOP && item.y <= CATCH_BOTTOM;
      if (inZone && Math.abs(item.x - s.fren.x) <= FREN_REACH + ITEM_RADIUS) {
        var spec = ITEMS[item.kind];
        if (spec.good) { s.score += spec.points; s.caught++; events.push({ type: 'catch', kind: item.kind, points: spec.points, x: item.x, y: item.y }); }
        else { s.lives--; events.push({ type: 'ouch', kind: item.kind, x: item.x, y: item.y }); }
        continue;
      }
      if (item.y < HEIGHT + ITEM_RADIUS * 2) kept.push(item);
    }
    s.items = kept;
    if (s.lives <= 0) { s.over = true; events.push({ type: 'over', score: s.score }); }
    return events;
  }

  var EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

  // Browser only. The hub supplies a verified animated NFT and the care bridge.
  function mount(host, api) {
    var area = document.createElement('div');
    area.className = 'game-area';
    area.tabIndex = 0;
    area.setAttribute('aria-label', 'Snack Catch play area. Drag, tap, or use the arrow keys to move your fren.');
    var canvas = document.createElement('canvas');
    var frenBox = document.createElement('div');
    frenBox.className = 'game-fren';
    var fren = api.makeFren();
    frenBox.append(fren);
    area.append(canvas, frenBox);
    host.append(area);

    var ctx = canvas.getContext('2d');
    var state = create();
    var scale = 1, raf = 0, last = 0, paused = false;
    var pointerX = null, keys = { left: false, right: false };
    var popups = [], hintFor = 2.5, eatTimer = 0, direction = 1;

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

    function toLocalX(clientX) { return (clientX - area.getBoundingClientRect().left) / scale; }
    area.addEventListener('pointerdown', function (e) { pointerX = toLocalX(e.clientX); area.setPointerCapture?.(e.pointerId); area.focus({ preventScroll: true }); });
    area.addEventListener('pointermove', function (e) { if (pointerX !== null || e.pointerType === 'mouse') pointerX = toLocalX(e.clientX); });
    area.addEventListener('pointerup', function () { pointerX = null; });
    area.addEventListener('pointercancel', function () { pointerX = null; });
    area.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') pointerX = null; });
    function onKey(down) {
      return function (e) {
        var k = e.key.toLowerCase();
        if (k === 'arrowleft' || k === 'a') keys.left = down;
        else if (k === 'arrowright' || k === 'd') keys.right = down;
        else return;
        e.preventDefault();
        if (down) pointerX = null;
      };
    }
    var keyDown = onKey(true), keyUp = onKey(false);
    area.addEventListener('keydown', keyDown);
    area.addEventListener('keyup', keyUp);
    area.addEventListener('blur', function () { keys.left = keys.right = false; pointerX = null; });

    function input() {
      if (pointerX !== null) return { targetX: pointerX };
      return { dir: (keys.right ? 1 : 0) - (keys.left ? 1 : 0) };
    }

    function react(events) {
      for (var i = 0; i < events.length; i++) {
        var e = events[i];
        if (e.type === 'catch') {
          popups.push({ text: '+' + e.points, x: e.x, y: e.y - 20, life: 0.7, color: '#ffe38a' });
          fren.dataset.action = 'eat'; eatTimer = 0.45;
        } else if (e.type === 'ouch') {
          popups.push({ text: 'ew!', x: e.x, y: e.y - 20, life: 0.8, color: '#ff8fa3' });
          area.classList.remove('game-ouch'); void area.offsetWidth; area.classList.add('game-ouch');
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '28px ' + EMOJI_FONT;
      for (var i = 0; i < state.items.length; i++) {
        var item = state.items[i];
        ctx.fillText(ITEMS[item.kind].emoji, item.x, item.y);
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
        ctx.fillText('Drag or use ← → to catch snacks.', WIDTH / 2, HEIGHT / 2 - 30);
        ctx.fillText('Dodge the socks 🧦', WIDTH / 2, HEIGHT / 2 - 6);
        ctx.globalAlpha = 1;
      }
      frenBox.style.transform = 'translate(' + (state.fren.x - FREN_W / 2) * scale + 'px,' + (CATCH_BOTTOM - FREN_H) * scale + 'px)';
    }

    function frame(now) {
      raf = 0;
      if (paused) return;
      var dt = last ? (now - last) / 1000 : 0;
      last = now;
      var previousX = state.fren.x;
      var events = step(state, dt, input());
      var moving = Math.abs(state.fren.x - previousX) > 0.01;
      if (moving) direction = state.fren.x > previousX ? 1 : -1;
      try { api.updatePlayer(state.time * 1000, moving, direction); }
      catch (error) { paused = true; api.onError(error); return; }
      react(events);
      hintFor = Math.max(0, hintFor - dt);
      for (var i = popups.length - 1; i >= 0; i--) { popups[i].life -= dt; popups[i].y -= 40 * dt; if (popups[i].life <= 0) popups.splice(i, 1); }
      if (eatTimer > 0) { eatTimer -= dt; if (eatTimer <= 0) fren.dataset.action = ''; }
      draw();
      if (state.over) { api.onEnd({ score: state.score, duration: state.time }); return; }
      raf = requestAnimationFrame(frame);
    }

    resize();
    area.focus({ preventScroll: true });
    raf = requestAnimationFrame(frame);

    return {
      pause: function () { paused = true; if (raf) cancelAnimationFrame(raf); raf = 0; },
      resume: function () {
        if (!paused || state.over) return;
        paused = false; last = 0; keys.left = keys.right = false; pointerX = null;
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
    WIDTH: WIDTH, HEIGHT: HEIGHT, ITEMS: ITEMS, START_LIVES: START_LIVES,
    CATCH_TOP: CATCH_TOP, CATCH_BOTTOM: CATCH_BOTTOM, FREN_REACH: FREN_REACH,
    create: create, step: step,
    game: {
      id: 'snack-catch',
      title: 'Snack Catch',
      emoji: '🍓',
      blurb: 'Catch falling snacks. Dodge the stinky socks.',
      careHint: 'Play for 15 seconds and catch a snack to earn the usual Play care effect.',
      mount: mount
    }
  };
});
