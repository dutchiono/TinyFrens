/*
 * TinyFrens pet engine — the ONE place care rules live.
 *
 * Every platform runs this exact file:
 *   - web:      <script src="pet-engine.js">          (window.TinyFrensEngine)
 *   - desktop:  require('./web/pet-engine.js')         (Electron main process)
 *   - Android:  evaluated with Rhino from the bundled web/ assets (PetEngine.kt)
 *   - iOS:      JavaScriptCore can evaluate it the same way
 *
 * Keep it plain ES5 (var/function, no arrow functions, spread, classes or template
 * literals) so the embedded engines can run it. All functions are pure: state in,
 * state out. Time (`now`, ms) and randomness (`rand`, () => [0,1)) are injectable so
 * behaviour is deterministic under test.
 *
 * Platforms persist the object returned by `save()` as a single JSON blob.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TinyFrensEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 4;
  var MINUTE = 60000, HOUR = 3600000, DAY = 86400000;

  var SHAPES = ['cat', 'blob', 'robot', 'bunny', 'duck', 'pig', 'frog', 'turtle'];
  var NAMES = {
    cat: ['Mochi', 'Whiskers', 'Biscuit', 'Pudding', 'Miso', 'Noodle', 'Tofu', 'Pebble', 'Marshmallow', 'Sprinkles', 'Mittens', 'Purrcy', 'Tiramisu', 'Butterscotch', 'Clementine', 'Nugget'],
    blob: ['Gloop', 'Jellybean', 'Bubbles', 'Squish', 'Wobble', 'Gumdrop', 'Puddle', 'Dumpling', 'Boba', 'Blorp', 'Jiggles', 'Plum', 'Goober', 'Squidge', 'Gelato', 'Bloop'],
    robot: ['Bolt', 'Widget', 'Sprocket', 'Beep', 'Gizmo', 'Pixel', 'Chip', 'Rivet', 'Zippy', 'Bleep', 'Cogsworth', 'Byte', 'Servo', 'Tinker', 'Boop-3', 'Sparky'],
    bunny: ['Boba', 'Pip', 'Cotton', 'Clover', 'Bunbun', 'Fluff', 'Mallow', 'Button'],
    duck: ['Ducky', 'Quackers', 'Waddles', 'Puddles', 'Mallard', 'Pebble', 'Buttercup', 'Sunny'],
    pig: ['Pip', 'Porky', 'Truffle', 'Hamlet', 'Oinky', 'Peaches', 'Blossom', 'Bubbles'],
    frog: ['Kero', 'Hoppy', 'Ribbit', 'Lily', 'Puddle', 'Sprout', 'Pickle', 'Toadstool'],
    turtle: ['Shelly', 'Koopa', 'Speedy', 'Pebble', 'Moss', 'Tank', 'Tortellini', 'Oogway']
  };
  var STAGES = ['Hatchling', 'Sprout', 'Elder'];

  // ---- Tunables -------------------------------------------------------------
  var RULES = {
    threshold: 25,            // Hungry / Sleepy / Sad at or below; Bored & Dirty need >= this
    happy: 75,                // "Happy" mood tier floor
    feed: 25,                 // Food per Feed
    play: { joy: 20, energy: 12, food: 8 },
    pet: 5,
    clean: 5,
    decayPerHour: { food: 3, joy: 2, energy: 1 },
    restPerHour: 20,          // energy regained per hour while resting
    restFoodFactor: 0.5,      // food decays slower while asleep
    adventurePerHour: { energy: 6, food: 2, joy: -3 }, // extra drain (joy negative = gain)
    adventureHomeAt: 20,      // fren walks home when energy drops to this
    sickJoyPerHour: 2,        // extra joy loss while sick
    dirtyJoyPerHour: 1,       // extra joy loss per poop
    boredEvery: [10 * HOUR, 14 * HOUR], // ~twice a day
    poopEvery: [21 * HOUR, 27 * HOUR],  // ~once a day
    maxPoops: 3,
    sick: { base: 0.002, perExposureHour: 0.01, max: 0.25, recoverPerHour: 0.5, healHours: 3 }, // healHours: calm frens auto-recover (vitamin is the fast fix)
    lost: { base: 0.0005, perExposureHour: 0.01, max: 0.2, recoverPerHour: 0.5, adventureWeight: 1.5,
      away: [1 * HOUR, 4 * HOUR], returnEnergy: 10 },
    nagEvery: 60 * MINUTE,    // pester again while a need is unresolved
    maxCatchUpDays: 30,
    // Robots v1 care additions (see docs/robots-care.md). Additive: the defaults
    // below leave existing shapes/pets with unchanged behaviour.
    weight: { start: 30, feed: 4, play: 3, adventurePerHour: 1, over: 70, under: 10, max: 100 },
    discipline: { start: 50, scoldRight: 12, scoldWrong: 8, misbehaveEvery: [4 * HOUR, 9 * HOUR], low: 25 },
    mistakes: { window: 45 * MINUTE, care: ['hungry', 'sleepy', 'bored', 'sad', 'dirty'], downAt: 12 },
    downed: { reviveFloor: 50 }
  };

  var NEEDS = {
    lost:    { icon: '❔', label: 'Lost',   fix: 'Wait',     line: ' wandered off… they will find their way home.' },
    downed:  { icon: '🪫', label: 'Downed', fix: 'Revive',   line: ' has run down. Revive them!' },
    sick:    { icon: '🤒', label: 'Sick',   fix: 'Vitamin',  line: ' feels sick. A vitamin would help.' },
    hungry:  { icon: '🍓', label: 'Hungry', fix: 'Feed',     line: ' is hungry!' },
    sleepy:  { icon: '💤', label: 'Sleepy', fix: 'Rest',     line: ' is sleepy. Time to rest.' },
    dirty:   { icon: '💩', label: 'Dirty',  fix: 'Clean',    line: ' made a mess. Please clean up!' },
    bored:   { icon: '🎾', label: 'Bored',  fix: 'Play',     line: ' is bored. Play with me!' },
    sad:     { icon: '💧', label: 'Sad',    fix: 'Play',     line: ' feels sad.' },
    misbehave: { icon: '😤', label: 'Misbehaving', fix: 'Scold', line: ' is acting up. Scold them!' }
  };
  var NEED_ORDER = ['lost', 'downed', 'sick', 'hungry', 'sleepy', 'dirty', 'bored', 'sad', 'misbehave'];

  var ANIMATION = { feed: 'eat', play: 'dance', rest: 'sleep', wave: 'wave', dance: 'dance', pet: 'happy', clean: 'happy', vitamin: 'eat', adventure: 'wave', toy: 'dance', scold: 'wave', revive: 'happy' };

  // ---- Helpers --------------------------------------------------------------
  function num(value, low, high, fallback) {
    var n = Number(value);
    if (value === null || value === undefined || value === '' || !isFinite(n)) return fallback;
    return Math.max(low, Math.min(high, n));
  }
  function round(n) { return Math.round(n * 10000) / 10000; }
  function lvl(n) { return Math.round(n); }
  function between(rand, range) { return range[0] + rand() * (range[1] - range[0]); }
  function copy(o) { var r = {}, k; for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
  function cleanName(n) {
    var s = String(n === null || n === undefined ? '' : n).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    // Slice by code point so emoji are never split.
    var out = '', count = 0, i, c;
    for (i = 0; i < s.length && count < 20; i++) {
      c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { out += s.charAt(i) + s.charAt(i + 1); i++; }
      else out += s.charAt(i);
      count++;
    }
    return out;
  }
  function randomName(shape, avoid, rand) {
    rand = rand || Math.random;
    var bank = (NAMES[shape] || NAMES.cat).filter(function (n) { return n !== avoid; });
    return bank[Math.floor(rand() * bank.length)];
  }
  function normalShape(shape) {
    if (shape === 'mascot') return 'robot';
    if (shape === 'dog') return 'duck';
    if (shape === 'bear') return 'pig';
    return SHAPES.indexOf(shape) >= 0 ? shape : 'cat';
  }
  function bool(value, fallback) { return typeof value === 'boolean' ? value : fallback; }

  // Fields owned by the engine. Anything else that is a primitive (e.g. wallet tokenId,
  // sound preference) is passed through untouched so platforms can add settings.
  var DERIVED = { needs: 1, need: 1, mood: 1, moodTier: 1, stage: 1, stageName: 1, feedback: 1, blocked: 1, animation: 1, events: 1, food: 1, joy: 1, day: 1, visible: 1, autoUpdate: 1, frameless: 1, hearts: 1 };

  function normalize(raw, now) {
    now = now || Date.now();
    raw = raw && typeof raw === 'object' ? raw : {};
    var s = {}, k;
    for (k in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, k) || DERIVED[k]) continue;
      var t = typeof raw[k];
      if (t === 'string' || t === 'number' || t === 'boolean') s[k] = raw[k];
    }
    s.v = VERSION;
    s.hunger = num(raw.hunger, 0, 100, 80);
    s.happiness = num(raw.happiness, 0, 100, 80);
    s.energy = num(raw.energy, 0, 100, 80);
    s.born = num(raw.born, 0, now, now);
    s.last = num(raw.last, 0, now, now);
    s.name = cleanName(raw.name);
    s.shape = normalShape(raw.shape);
    s.color = /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color : '#a474f1';
    s.size = num(raw.size, 56, 128, 80);
    s.speed = num(raw.speed, 20, 140, 60);
    s.opacity = num(raw.opacity, 40, 100, 100);
    s.mode = raw.mode === 'bubble' ? 'bubble' : 'roam';
    s.sparkles = bool(raw.sparkles, true);
    s.screenEffects = bool(raw.screenEffects, true);
    s.fade = bool(raw.fade, true);
    s.haptics = bool(raw.haptics, true);
    s.reduceMotion = bool(raw.reduceMotion, false);
    s.expression = (typeof raw.expression === 'string' && ['happy', 'wink', 'shades', 'star_eyes', 'sleepy', 'loving', 'laser', 'grin'].indexOf(raw.expression) >= 0) ? raw.expression : 'happy';
    s.accessory = (typeof raw.accessory === 'string' && ['none', 'party_hat', 'crown', 'halo', 'bow_tie', 'orb'].indexOf(raw.accessory) >= 0) ? raw.accessory : 'none';
    // Extended care state
    s.activity = ['idle', 'resting', 'adventuring', 'lost'].indexOf(raw.activity) >= 0 ? raw.activity : 'idle';
    s.poops = Math.floor(num(raw.poops, 0, RULES.maxPoops, 0));
    s.sick = raw.sick === true;
    s.sickHealUntil = num(raw.sickHealUntil, 0, Infinity, 0);
    s.bored = raw.bored === true;
    s.lostUntil = num(raw.lostUntil, 0, Infinity, 0);
    s.nextBoredAt = num(raw.nextBoredAt, 0, Infinity, 0) || now + RULES.boredEvery[0];
    s.nextPoopAt = num(raw.nextPoopAt, 0, Infinity, 0) || now + RULES.poopEvery[0];
    s.sickExposure = num(raw.sickExposure, 0, 1000, 0);
    s.lostExposure = num(raw.lostExposure, 0, 1000, 0);
    s.weight = num(raw.weight, 0, RULES.weight.max, RULES.weight.start);
    s.discipline = num(raw.discipline, 0, 100, RULES.discipline.start);
    s.mistakes = Math.floor(num(raw.mistakes, 0, 9999, 0));
    s.misbehaving = raw.misbehaving === true;
    s.downed = raw.downed === true;
    s.neglectSince = num(raw.neglectSince, 0, Infinity, 0);
    s.nextMisbehaveAt = num(raw.nextMisbehaveAt, 0, Infinity, 0) || now + RULES.discipline.misbehaveEvery[0];
    s.action = typeof raw.action === 'string' ? raw.action : 'idle';
    s.actionUntil = num(raw.actionUntil, 0, Infinity, 0);
    s.nagged = parseMap(raw.nagged);
    s.inbox = parseList(raw.inbox);
    return s;
  }
  // nagged/inbox are stored as JSON strings so every platform can persist the state flat.
  function parseMap(v) { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = {}; } } return v && typeof v === 'object' && !(v instanceof Array) ? v : {}; }
  function parseList(v) { if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = []; } } return v instanceof Array ? v.slice(-10) : []; }

  // ---- Needs ----------------------------------------------------------------
  function activeNeeds(s) {
    var t = RULES.threshold, on = {
      lost: s.activity === 'lost',
      downed: s.downed === true,
      sick: s.sick,
      hungry: lvl(s.hunger) <= t,
      sleepy: lvl(s.energy) <= t && s.activity !== 'resting',
      dirty: s.poops > 0,
      bored: s.bored,
      sad: lvl(s.happiness) <= t,
      misbehave: s.misbehaving === true
    };
    if (on.lost) return ['lost'];
    if (on.downed) return ['downed'];
    return NEED_ORDER.filter(function (n) { return on[n]; });
  }
  function moodTier(s) { var j = lvl(s.happiness); return j <= RULES.threshold ? 'sad' : j >= RULES.happy ? 'happy' : 'okay'; }
  // Four hearts per stat: 0 -> 0, 1..25 -> 1, up to 100 -> 4.
  function hearts(v) { return Math.max(0, Math.min(4, Math.ceil(lvl(v) / 25))); }
  function weightTier(s) {
    return s.weight > RULES.weight.over ? 'heavy' : s.weight < RULES.weight.under ? 'light' : 'healthy';
  }

  // ---- Time -----------------------------------------------------------------
  function step(s, start, dtMin, rand) {
    var h = dtMin / 60, at = start + dtMin * MINUTE, r = RULES, d = r.decayPerHour;
    if (s.activity === 'lost') {
      s.hunger -= d.food * h;
      if (at >= s.lostUntil) {
        s.activity = 'idle'; s.lostUntil = 0; s.lostExposure = 0;
        s.energy = Math.min(s.energy, r.lost.returnEnergy);
        s.inbox.push({ type: 'returned', at: at });
      }
      return clampStats(s);
    }
    // A downed fren is stalled until revived: time passes, but nothing decays further.
    if (s.downed) return clampStats(s);
    var foodLoss = d.food, joyLoss = d.joy, energyLoss = d.energy;
    if (s.activity === 'resting') { foodLoss *= r.restFoodFactor; energyLoss = -r.restPerHour; }
    if (s.activity === 'adventuring') { foodLoss += r.adventurePerHour.food; energyLoss += r.adventurePerHour.energy; joyLoss += r.adventurePerHour.joy; s.weight -= r.weight.adventurePerHour * h; }
    if (s.sick) joyLoss += r.sickJoyPerHour;
    joyLoss += s.poops * r.dirtyJoyPerHour;
    s.hunger -= foodLoss * h; s.happiness -= joyLoss * h; s.energy -= energyLoss * h;
    clampStats(s);

    if (s.activity === 'resting' && lvl(s.energy) >= 100) { s.energy = 100; s.activity = 'idle'; s.inbox.push({ type: 'woke', at: at }); }
    if (s.activity === 'adventuring' && lvl(s.energy) <= r.adventureHomeAt) { s.activity = 'idle'; s.inbox.push({ type: 'home', at: at }); }

    // Scheduled needs: they wait until their condition is met, then reschedule.
    if (!s.bored && at >= s.nextBoredAt && s.activity === 'idle' && lvl(s.energy) >= r.threshold) {
      s.bored = true; s.nextBoredAt = at + between(rand, r.boredEvery);
    }
    if (at >= s.nextPoopAt && s.activity !== 'adventuring' && lvl(s.hunger) >= r.threshold) {
      s.poops = Math.min(r.maxPoops, s.poops + 1); s.nextPoopAt = at + between(rand, r.poopEvery);
    }
    if (!s.misbehaving && at >= s.nextMisbehaveAt && s.activity === 'idle' && lvl(s.energy) >= r.threshold) {
      s.misbehaving = true; s.nextMisbehaveAt = at + between(rand, r.discipline.misbehaveEvery);
    }

    // Care mistakes: a care need left unmet past the window counts once per window.
    var care = activeNeeds(s), unmet = 0, j;
    for (j = 0; j < care.length; j++) if (r.mistakes.care.indexOf(care[j]) >= 0) unmet++;
    if (unmet) {
      if (!s.neglectSince) s.neglectSince = at;
      else if (at - s.neglectSince >= r.mistakes.window) { s.mistakes++; s.neglectSince = at; }
    } else s.neglectSince = 0;

    // Sickness: always possible; time spent neglected raises the odds.
    var needs = activeNeeds(s), neglect = 0, i;
    for (i = 0; i < needs.length; i++) if (needs[i] === 'hungry' || needs[i] === 'sleepy' || needs[i] === 'bored' || needs[i] === 'sad' || needs[i] === 'dirty') neglect++;
    s.sickExposure = neglect ? s.sickExposure + neglect * h : Math.max(0, s.sickExposure - r.sick.recoverPerHour * h);
    // Out-of-band weight and low discipline make illness likelier (neutral at the defaults).
    if (s.weight > r.weight.over || s.weight < r.weight.under) s.sickExposure += h;
    if (s.discipline < r.discipline.low) s.sickExposure += h;
    if (!s.sick && rand() < Math.min(r.sick.max, r.sick.base + r.sick.perExposureHour * s.sickExposure) * h) {
      s.sick = true; s.sickExposure = 0;
    }
    // Sickness auto-recovery: a calm fren (no active neglect) mends after healHours.
    // A vitamin still cures instantly; this is the fallback so a pet never stays sick forever.
    if (s.sick) {
      if (neglect) s.sickHealUntil = 0;
      else if (!s.sickHealUntil) s.sickHealUntil = at + r.sick.healHours * HOUR;
      else if (at >= s.sickHealUntil) {
        s.sick = false; s.sickHealUntil = 0; s.sickExposure = 0;
        s.inbox.push({ type: 'healed', at: at });
      }
    }

    // Getting lost: always possible (not while asleep); sadness and adventuring raise the odds.
    var sad = lvl(s.happiness) <= r.threshold, away = s.activity === 'adventuring';
    var exposure = (sad ? 1 : 0) + (away ? r.lost.adventureWeight : 0);
    s.lostExposure = exposure ? s.lostExposure + exposure * h : Math.max(0, s.lostExposure - r.lost.recoverPerHour * h);
    if (s.activity !== 'resting' && rand() < Math.min(r.lost.max, r.lost.base + r.lost.perExposureHour * s.lostExposure) * h) {
      s.activity = 'lost'; s.lostUntil = at + between(rand, r.lost.away); s.bored = false;
    }
    // Too many unmet needs run a fren down. No permadeath: revive brings them back (P4 adds the cost).
    if (!s.downed && s.mistakes >= r.mistakes.downAt) {
      s.downed = true; s.misbehaving = false; s.bored = false;
      s.hunger = 0; s.happiness = 0; s.energy = 0;
    }
    return s;
  }
  function clampStats(s) {
    s.hunger = round(Math.max(0, Math.min(100, s.hunger)));
    s.happiness = round(Math.max(0, Math.min(100, s.happiness)));
    s.energy = round(Math.max(0, Math.min(100, s.energy)));
    return s;
  }

  // Queue a notification for each need that just appeared, and re-nag on an interval.
  function pester(s, now) {
    var needs = activeNeeds(s), seen = {}, i, n;
    for (i = 0; i < needs.length; i++) {
      n = needs[i]; seen[n] = 1;
      if (!s.nagged[n] || now - s.nagged[n] >= RULES.nagEvery) {
        s.nagged[n] = now;
        s.inbox.push({ type: 'need', need: n, at: now });
      }
    }
    for (n in s.nagged) if (!seen[n]) delete s.nagged[n];
    if (s.inbox.length > 10) s.inbox = s.inbox.slice(-10);
    return s;
  }

  /** Advance the simulation to `now`. Cheap when less than a minute has passed. */
  function advance(raw, now, rand) {
    now = now || Date.now(); rand = rand || Math.random;
    var s = normalize(raw, now);
    var elapsedMin = Math.floor((now - s.last) / MINUTE);
    if (elapsedMin <= 0) return s;
    var cap = RULES.maxCatchUpDays * 24 * 60;
    if (elapsedMin > cap) { s.last = now - cap * MINUTE; elapsedMin = cap; }
    // Long absences use coarser steps so catch-up stays fast on embedded JS engines.
    var dt = Math.max(1, Math.ceil(elapsedMin / 3000)), done = 0, take;
    while (done < elapsedMin) {
      take = Math.min(dt, elapsedMin - done);
      step(s, s.last + done * MINUTE, take, rand);
      done += take;
    }
    s.last += elapsedMin * MINUTE;
    return pester(s, now);
  }

  // ---- Actions --------------------------------------------------------------
  function blockedReason(s, name) {
    var r = RULES, who = s.name || 'Your fren';
    if (s.activity === 'lost' && name !== 'wave') return who + ' is lost. They will come home soon.';
    if (s.downed && name !== 'revive' && name !== 'wave' && name !== 'dance' && name !== 'toy') return who + ' has run down. Revive them!';
    if (name === 'revive' && !s.downed) return who + ' does not need reviving.';
    if (name === 'feed') {
      if (s.activity === 'resting') return 'Shh… ' + who + ' is sleeping.';
      if (lvl(s.hunger) >= 100) return 'Already full.';
    }
    if (name === 'play') {
      if (s.activity === 'resting') return 'Shh… ' + who + ' is sleeping.';
      if (s.activity === 'adventuring') return who + ' is out adventuring.';
      if (s.sick) return 'Too sick to play. Try a vitamin.';
      if (s.energy < r.play.energy) return 'A nap first, then play.';
      if (s.hunger < r.play.food) return 'Too hungry to play. Feed first.';
    }
    if (name === 'rest' && s.activity !== 'resting') {
      if (s.activity === 'adventuring') return who + ' is out adventuring.';
      if (lvl(s.energy) >= 100) return 'Not sleepy yet.';
    }
    if (name === 'adventure' && s.activity !== 'adventuring') {
      if (s.activity === 'resting') return 'Shh… ' + who + ' is sleeping.';
      if (s.sick) return 'Too sick to explore.';
      if (lvl(s.energy) <= r.threshold) return 'Too tired to explore.';
    }
    if (name === 'clean' && s.poops <= 0) return 'All clean already.';
    if (name === 'vitamin' && !s.sick) return who + ' is healthy.';
    if (name === 'pet' && s.activity === 'adventuring') return who + ' is out adventuring.';
    return '';
  }

  /** Apply a care action. Returns { state, blocked, feedback, animation }. */
  function act(raw, name, now, rand) {
    now = now || Date.now(); rand = rand || Math.random;
    var s = advance(raw, now, rand), r = RULES;
    var blocked = blockedReason(s, name);
    if (blocked) return { state: s, blocked: true, feedback: blocked, animation: '' };
    var before = copy(s), feedback = '';
    function add(k, n) { s[k] = round(Math.max(0, Math.min(100, s[k] + n))); }
    function gain(k) { return lvl(s[k]) - lvl(before[k]); }
    if (name === 'feed') { add('hunger', r.feed); add('weight', r.weight.feed); feedback = 'Food +' + gain('hunger'); }
else if (name === 'play') {
      add('happiness', r.play.joy);
      if (s.bored) { s.bored = false; if (s.happiness < r.happy) s.happiness = r.happy; }
      else if (lvl(s.happiness) <= r.threshold) s.happiness = r.threshold + 1; // a good play session always cheers a sad fren out of the sad band
      add('energy', -r.play.energy); add('hunger', -r.play.food); add('weight', -r.weight.play);
      feedback = 'Joy +' + gain('happiness') + ' · Energy −' + r.play.energy + ' · Food −' + r.play.food;
    }
    else if (name === 'rest') {
      if (s.activity === 'resting') { s.activity = 'idle'; feedback = (s.name || 'Your fren') + ' woke up.'; }
      else { s.activity = 'resting'; feedback = 'Resting… Energy +' + r.restPerHour + '/hour.'; }
    }
    else if (name === 'adventure') {
      if (s.activity === 'adventuring') { s.activity = 'idle'; feedback = (s.name || 'Your fren') + ' came home.'; }
      else { s.activity = 'adventuring'; s.bored = false; feedback = (s.name || 'Your fren') + ' set off exploring!'; }
    }
    else if (name === 'clean') { s.poops = 0; add('happiness', r.clean); feedback = 'Squeaky clean!'; }
    else if (name === 'vitamin') { s.sick = false; s.sickExposure = 0; s.sickHealUntil = 0; feedback = 'Feeling better!'; }
    else if (name === 'pet') { add('happiness', r.pet); feedback = 'Joy +' + gain('happiness'); }
    else if (name === 'scold') {
      if (s.misbehaving) { s.misbehaving = false; add('discipline', r.discipline.scoldRight); feedback = 'Scolded. Discipline +' + gain('discipline'); }
      else { s.discipline = round(Math.max(0, s.discipline - r.discipline.scoldWrong)); feedback = (s.name || 'Your fren') + ' did nothing wrong. Discipline −' + r.discipline.scoldWrong; }
      s.nextMisbehaveAt = now + between(rand, r.discipline.misbehaveEvery);
    }
    else if (name === 'revive') {
      s.downed = false; s.mistakes = 0; s.neglectSince = 0;
      s.hunger = r.downed.reviveFloor; s.happiness = r.downed.reviveFloor; s.energy = r.downed.reviveFloor;
      s.sick = false; s.sickHealUntil = 0; s.poops = 0; s.bored = false; s.misbehaving = false;
      feedback = (s.name || 'Your fren') + ' is up again!';
    }
    var animation = ANIMATION[name] || 'idle';
    if (name === 'rest' && s.activity !== 'resting') animation = 'idle';
    s.action = animation;
    s.actionUntil = now + (animation === 'sleep' ? 15000 : 6000);
    pester(s, now);
    return { state: s, blocked: false, feedback: feedback, animation: animation };
  }

  function rename(raw, name, now) {
    var s = advance(raw, now), clean = cleanName(name);
    if (clean) s.name = clean;
    return s;
  }
  var CUSTOMIZABLE = ['color', 'shape', 'size', 'speed', 'opacity', 'sparkles', 'screenEffects', 'fade', 'haptics', 'reduceMotion', 'name', 'tokenId', 'sounds', 'expression', 'accessory'];
  function customize(raw, patch, now) {
    var s = advance(raw, now), next = copy(s), i, k;
    patch = patch && typeof patch === 'object' ? patch : {};
    for (i = 0; i < CUSTOMIZABLE.length; i++) { k = CUSTOMIZABLE[i]; if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k]; }
    if (Object.prototype.hasOwnProperty.call(patch, 'name')) next.name = cleanName(patch.name) || s.name;
    return normalize(next, now);
  }
  function setMode(raw, mode, now) { var s = advance(raw, now); s.mode = mode === 'bubble' ? 'bubble' : 'roam'; return s; }

  /** Remove and return queued notifications as { state, notifications:[{need,title,body}] }. */
  function takeNotifications(raw, now) {
    var s = normalize(raw, now), who = s.name || 'Your fren', out = [], i, e;
    for (i = 0; i < s.inbox.length; i++) {
      e = s.inbox[i];
      if (e.type === 'need' && NEEDS[e.need]) out.push({ kind: e.need, title: NEEDS[e.need].icon + ' ' + who + ' is ' + NEEDS[e.need].label.toLowerCase(), body: who + NEEDS[e.need].line });
      else if (e.type === 'returned') out.push({ kind: 'returned', title: '🏠 ' + who + ' is home!', body: who + ' found the way back, tired but safe.' });
      else if (e.type === 'woke') out.push({ kind: 'woke', title: '☀️ ' + who + ' woke up', body: 'Fully rested and ready to play.' });
      else if (e.type === 'healed') out.push({ kind: 'healed', title: '💚 ' + who + ' is feeling better', body: 'A little rest beat the sniffles. No vitamin needed.' });
      else if (e.type === 'home') out.push({ kind: 'home', title: '🧭 ' + who + ' is back from adventuring', body: 'All tuckered out.' });
    }
    s.inbox = [];
    return { state: s, notifications: out };
  }

  /** Persistable copy (nested structures flattened to JSON strings). */
  function save(s) {
    var out = normalize(s, s && s.last), k;
    var flat = {};
    for (k in out) if (Object.prototype.hasOwnProperty.call(out, k)) flat[k] = out[k];
    flat.nagged = JSON.stringify(out.nagged);
    flat.inbox = JSON.stringify(out.inbox);
    return flat;
  }

  /** Read-only view for UI: rounded stats plus derived needs/mood/stage. */
  function view(s, now) {
    now = now || Date.now();
    var v = save(s), needs = activeNeeds(s), who = s.name || 'Your fren', age = Math.max(0, now - s.born);
    v.hunger = lvl(s.hunger); v.happiness = lvl(s.happiness); v.energy = lvl(s.energy);
    v.food = v.hunger; v.joy = v.happiness;
    v.weight = lvl(s.weight); v.discipline = lvl(s.discipline); v.mistakes = s.mistakes;
    v.weightTier = weightTier(s);
    v.hearts = { hunger: hearts(s.hunger), happiness: hearts(s.happiness) };
    v.needs = needs.join(',');
    v.need = needs[0] || '';
    v.moodTier = moodTier(s);
    v.stage = Math.min(2, Math.floor(age / DAY));
    v.stageName = STAGES[v.stage];
    v.day = Math.floor(age / DAY);
    v.mood = needs.length ? who + NEEDS[needs[0]].line
      : s.activity === 'resting' ? who + ' is resting. Zzz…'
      : s.activity === 'adventuring' ? who + ' is out exploring.'
      : v.moodTier === 'happy' ? who + ' is happy!' : who + ' is curious.';
    v.expression = s.expression || 'happy';
    v.accessory = s.accessory || 'none';
    if (s.activity === 'resting') v.action = 'sleep';
    return v;
  }

  // ---- String bridge for embedded engines (Rhino / JavaScriptCore) ------------
  // bridge('read'|'act'|'rename'|'customize'|'mode'|'notifications', stateJson, argJson, nowMs)
  // -> JSON string { state: <persist this>, view: <show this>, ... }
  function bridge(method, stateJson, argJson, now) {
    now = Number(now) || Date.now();
    var raw = {}, arg = null, out = {}, s;
    try { raw = JSON.parse(stateJson || '{}'); } catch (e) { raw = {}; }
    try { arg = argJson ? JSON.parse(argJson) : null; } catch (e2) { arg = null; }
    if (method === 'act') { var r = act(raw, String(arg), now); s = r.state; out.blocked = r.blocked; out.feedback = r.feedback; out.animation = r.animation; }
    else if (method === 'rename') s = rename(raw, arg, now);
    else if (method === 'customize') s = customize(raw, arg, now);
    else if (method === 'mode') s = setMode(raw, arg, now);
    else if (method === 'notifications') { var n = takeNotifications(advance(raw, now), now); s = n.state; out.notifications = n.notifications; }
    else s = advance(raw, now);
    out.state = save(s);
    out.view = view(s, now);
    if (method === 'act') { out.view.feedback = out.feedback; out.view.blocked = out.blocked; }
    return JSON.stringify(out);
  }

  return {
    VERSION: VERSION, RULES: RULES, NEEDS: NEEDS, NEED_ORDER: NEED_ORDER, SHAPES: SHAPES, NAMES: NAMES, STAGES: STAGES, ANIMATION: ANIMATION,
    cleanName: cleanName, randomName: randomName, normalShape: normalShape,
    normalize: normalize, advance: advance, act: act, rename: rename, customize: customize, setMode: setMode,
    activeNeeds: activeNeeds, moodTier: moodTier, hearts: hearts, weightTier: weightTier, takeNotifications: takeNotifications, save: save, view: view, bridge: bridge
  };
});
