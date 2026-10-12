// TinyFrens collection gallery.
// Mirrors the on-chain art()/tokenURI() output for local previews and, on demand,
// pulls the exact art from the deployed contract via /api/nft/uri.
(function () {
  "use strict";

  const MAX_SUPPLY = 2664;
  const MASK64 = (1n << 64n) - 1n;

  const SPECIES = ["Cat", "Blob", "Robot", "Bunny", "Puppy", "Bear", "Frog", "Turtle"];
  const PALETTE = [
    ["#a474f1", "#4b2d77", "#17142a", "Lavender Dream", "Classic"],
    ["#66c7d2", "#235960", "#0d1117", "Cyber Neon", "Classic"],
    ["#ffb95e", "#7a4e12", "#fff7ed", "Sunny Amber", "Classic"],
    ["#82eba1", "#235f37", "#e8f5e9", "Mint Meadow", "Classic"],
    ["#ff82a7", "#6f233a", "#fdf2f8", "Bubblegum", "Classic"],
    ["#4d96ff", "#1b3f75", "#f0f9ff", "Electric Blue", "Classic"],
    ["#3a2d52", "#1e162d", "#211c39", "Midnight Obsidian", "Rare"],
    ["#ffd700", "#b7791f", "#2d132c", "24K Solid Gold", "Legendary"],
  ];
  const EXPR = ["Classic Happy", "Playful Wink", "Cool Shades", "Star Eyes"];
  const ACC = ["None", "Party Hat", "Royal Crown", "Angel Halo", "Dapper Bow Tie", "Mystic Orb"];
  const ERA = ["Pocket Genesis", "Street Wanderers", "Dream Garden"];
  const HABITAT = ["Moonlit Plaza", "Neon Crosswalk", "Snack Garden", "Cloud Room", "Arcade Alley", "Tiny Meadow"];
  const MOTION = ["Happy Walk", "Bouncy Strut", "Sleepy Drift", "Excited Wiggle"];

  // --- deterministic preview PRNG (mirrors a 64-bit mix; preview only) ---
  function fmix64(x) {
    x &= MASK64;
    x = (x ^ (x >> 33n)) & MASK64;
    x = (x * 0xff51afd7ed558ccdn) & MASK64;
    x = (x ^ (x >> 33n)) & MASK64;
    x = (x * 0xc4ceb9fe1a85ec53n) & MASK64;
    x = (x ^ (x >> 33n)) & MASK64;
    return x;
  }
  function makePrng(seed) {
    let state = seed & MASK64;
    return {
      uniform(n) {
        state = fmix64(state);
        return Number((state * BigInt(n)) >> 64n);
      },
    };
  }

  function traitsFor(id, seed) {
    const p = makePrng(seed === undefined ? fmix64(BigInt(id) * 0x9e3779b97f4a7c15n) : seed);
    const t = { species: (id - 1) % 8 };
    const palRoll = p.uniform(100);
    if (palRoll < 5) t.palette = 7;
    else if (palRoll < 20) t.palette = 6;
    else t.palette = p.uniform(6);
    t.expr = p.uniform(4);
    t.acc = p.uniform(6);
    t.era = Math.floor((id - 1) / 888);
    t.habitat = p.uniform(6);
    t.motion = p.uniform(4);
    return t;
  }

  // --- SVG builder (ported from contracts/TinyFrensNFT.sol:art) ---
  function art(t) {
    const pal = PALETTE[t.palette];
    const body = pal[0], dark = pal[1], bg = pal[2];
    let ears = "", shell = "", species = "", limbs = "", shine = "";
    let habitat = "", motionValues = "0 0;0 -3;0 0", motionDur = "1.4s";

    if (t.habitat === 0) habitat = `<circle cx="18" cy="22" r="3" fill="#fff" opacity=".7"/><circle cx="102" cy="31" r="2" fill="#fff" opacity=".55"/><path d="M12 126 H116" stroke="#fff" stroke-width="2" opacity=".12"/>`;
    else if (t.habitat === 1) habitat = `<path d="M0 120 H128" stroke="#00d2d3" stroke-width="4" opacity=".32"/><path d="M8 132 H38 M54 132 H84 M100 132 H126" stroke="#fff" stroke-width="4" opacity=".22"/><circle cx="108" cy="22" r="7" fill="#ff82a7" opacity=".5"/>`;
    else if (t.habitat === 2) habitat = `<path d="M0 124 C22 114 42 134 64 122 C86 110 104 128 128 116 V148 H0 Z" fill="#82eba1" opacity=".28"/><circle cx="18" cy="110" r="3" fill="#ff4757"/><circle cx="104" cy="118" r="3" fill="#ff4757"/>`;
    else if (t.habitat === 3) habitat = `<ellipse cx="30" cy="28" rx="18" ry="7" fill="#fff" opacity=".22"/><ellipse cx="92" cy="42" rx="22" ry="8" fill="#fff" opacity=".18"/><path d="M0 130 C20 124 42 128 64 123 C86 118 108 124 128 119 V148 H0 Z" fill="#fff" opacity=".12"/>`;
    else if (t.habitat === 4) habitat = `<rect x="8" y="16" width="18" height="18" rx="4" fill="#ffd700" opacity=".32"/><rect x="102" y="20" width="14" height="30" rx="4" fill="#66c7d2" opacity=".28"/><path d="M8 128 H120" stroke="#ffd700" stroke-width="3" stroke-dasharray="8 7" opacity=".32"/>`;
    else habitat = `<path d="M0 126 Q32 112 64 124 T128 122 V148 H0 Z" fill="#82eba1" opacity=".24"/><circle cx="24" cy="112" r="4" fill="#ffd700" opacity=".7"/><circle cx="112" cy="108" r="3" fill="#ffd700" opacity=".65"/>`;

    if (t.motion === 1) { motionValues = "0 0;0 -7;0 0"; motionDur = "0.8s"; }
    else if (t.motion === 2) { motionValues = "0 0;1 -2;0 0"; motionDur = "2.4s"; }
    else if (t.motion === 3) { motionValues = "0 0;-2 -4;2 -4;0 0"; motionDur = "0.9s"; }

    if (t.species === 0) {
      ears = `<path d="M18 45 L34 6 L54 43 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M74 43 L94 6 L110 45 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M29 34 L36 17 L45 35 Z M83 35 L92 17 L99 34 Z" fill="#ffb6c8" opacity=".78"/><path d="M102 105 C132 98 130 64 103 75 C122 79 121 99 102 97" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/>`;
      limbs = `<path d="M30 119 C21 126 19 137 35 137 H49 C47 126 39 120 30 119 Z" fill="${dark}"/><path d="M79 119 C88 120 97 126 99 137 H82 C72 137 72 126 79 119 Z" fill="${dark}"/>`;
      species = `<path d="M21 88 H5 M22 96 H7 M107 88 H123 M106 96 H121" stroke="${dark}" stroke-width="3" stroke-linecap="round"/><path d="M58 94 Q64 99 70 94" stroke="${dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      shine = `<ellipse cx="43" cy="55" rx="16" ry="13" fill="url(#shine)"/>`;
    } else if (t.species === 1) {
      limbs = `<path d="M28 124 C20 131 27 140 39 134" fill="${dark}" opacity=".58"/><path d="M88 126 C99 132 97 141 83 136" fill="${dark}" opacity=".58"/>`;
      shell = `<path d="M31 58 C19 75 19 112 40 125 C53 134 57 120 68 126 C90 136 111 116 108 86 C105 56 89 45 70 52 C54 40 39 43 31 58 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/><path d="M38 55 C47 47 56 47 65 55" stroke="#fff" stroke-width="4" opacity=".22" fill="none" stroke-linecap="round"/>`;
      species = `<path d="M30 101 C45 93 50 114 64 104 C79 94 87 112 101 101" stroke="${dark}" stroke-width="3" opacity=".36" fill="none" stroke-linecap="round"/>`;
      shine = `<ellipse cx="47" cy="62" rx="19" ry="16" fill="url(#shine)"/>`;
    } else if (t.species === 2) {
      ears = `<path d="M64 30 V11" stroke="${dark}" stroke-width="7" stroke-linecap="round"/><circle cx="64" cy="8" r="6" fill="${body}" stroke="${dark}" stroke-width="3"/><circle cx="64" cy="8" r="2" fill="#fff"/>`;
      limbs = `<path d="M22 84 H11 V105 H22" fill="none" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M106 84 H117 V105 H106" fill="none" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M31 129 H50 M78 129 H97" stroke="${dark}" stroke-width="9" stroke-linecap="round"/>`;
      species = `<path d="M36 59 H92 M40 106 H88" stroke="${dark}" stroke-width="3" opacity=".45"/><circle cx="45" cy="108" r="3" fill="${dark}" opacity=".55"/><circle cx="83" cy="108" r="3" fill="${dark}" opacity=".55"/>`;
      shine = `<rect x="39" y="44" width="15" height="10" rx="3" fill="#fff" opacity=".2"/>`;
    } else if (t.species === 3) {
      ears = `<path d="M34 58 C22 38 22 11 36 4 C52 8 52 40 43 61 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M94 58 C106 38 106 11 92 4 C76 8 76 40 85 61 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M37 47 C32 33 33 19 38 13 M91 47 C96 33 95 19 90 13" stroke="#ffb6c8" stroke-width="5" stroke-linecap="round" opacity=".72"/>`;
      limbs = `<ellipse cx="42" cy="132" rx="18" ry="8" fill="${dark}"/><ellipse cx="86" cy="132" rx="18" ry="8" fill="${dark}"/>`;
      species = `<rect x="58" y="101" width="5" height="10" rx="1" fill="#fff"/><rect x="65" y="101" width="5" height="10" rx="1" fill="#fff"/><circle cx="103" cy="104" r="8" fill="#fff" opacity=".55"/>`;
      shine = `<ellipse cx="47" cy="62" rx="15" ry="14" fill="url(#shine)"/>`;
    } else if (t.species === 4) {
      ears = `<path d="M26 48 C7 42 4 63 20 82 C33 78 37 61 26 48 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M102 48 C121 42 124 63 108 82 C95 78 91 61 102 48 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M103 111 C119 116 123 101 112 94" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/>`;
      limbs = `<path d="M29 124 C22 132 29 139 43 135" fill="${dark}"/><path d="M85 124 C98 126 103 134 94 139 H80 C78 133 80 128 85 124 Z" fill="${dark}"/>`;
      species = `<ellipse cx="64" cy="97" rx="23" ry="16" fill="#fff" opacity=".34"/><path d="M55 94 Q64 101 73 94" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="64" cy="91" r="5" fill="${dark}"/>`;
      shine = `<ellipse cx="43" cy="59" rx="15" ry="13" fill="url(#shine)"/>`;
    } else if (t.species === 5) {
      ears = `<circle cx="28" cy="35" r="17" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="100" cy="35" r="17" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="28" cy="35" r="8" fill="#ffb6c8" opacity=".6"/><circle cx="100" cy="35" r="8" fill="#ffb6c8" opacity=".6"/>`;
      limbs = `<circle cx="35" cy="119" r="10" fill="${dark}" opacity=".75"/><circle cx="93" cy="119" r="10" fill="${dark}" opacity=".75"/><path d="M31 134 H50 M78 134 H97" stroke="${dark}" stroke-width="8" stroke-linecap="round"/>`;
      species = `<ellipse cx="64" cy="100" rx="25" ry="18" fill="#fff" opacity=".32"/><circle cx="64" cy="94" r="5" fill="${dark}"/><path d="M55 104 Q64 111 73 104" stroke="${dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      shine = `<ellipse cx="43" cy="59" rx="17" ry="14" fill="url(#shine)"/>`;
    } else if (t.species === 6) {
      ears = `<circle cx="34" cy="38" r="18" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="94" cy="38" r="18" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="34" cy="38" r="6" fill="#fff"/><circle cx="94" cy="38" r="6" fill="#fff"/><circle cx="34" cy="38" r="3" fill="${dark}"/><circle cx="94" cy="38" r="3" fill="${dark}"/>`;
      limbs = `<path d="M22 120 C10 123 9 136 27 134 H43" fill="${dark}"/><path d="M106 120 C118 123 119 136 101 134 H85" fill="${dark}"/>`;
      species = `<path d="M37 101 Q64 117 91 101" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="45" cy="94" r="3" fill="${dark}" opacity=".38"/><circle cx="83" cy="94" r="3" fill="${dark}" opacity=".38"/>`;
      shine = `<ellipse cx="44" cy="65" rx="17" ry="12" fill="url(#shine)"/>`;
    } else {
      ears = `<ellipse cx="64" cy="56" rx="22" ry="18" fill="${body}" stroke="${dark}" stroke-width="7"/><path d="M17 91 C6 91 4 103 17 106 M111 91 C122 91 124 103 111 106" stroke="${dark}" stroke-width="8" stroke-linecap="round" fill="none"/>`;
      limbs = `<path d="M29 124 L18 136 H42 Z" fill="${dark}"/><path d="M99 124 L110 136 H86 Z" fill="${dark}"/>`;
      shell = `<ellipse cx="64" cy="94" rx="42" ry="35" fill="url(#body)" stroke="${dark}" stroke-width="8"/><ellipse cx="64" cy="94" rx="27" ry="24" fill="none" stroke="${dark}" stroke-width="5" opacity=".78"/><path d="M37 94 H91 M64 70 V118 M46 78 Q64 91 82 78 M46 110 Q64 97 82 110" stroke="${dark}" stroke-width="3" fill="none" opacity=".78"/>`;
      species = "";
      shine = `<ellipse cx="50" cy="81" rx="15" ry="11" fill="url(#shine)"/>`;
    }

    let eyes = "";
    if (t.expr === 0) {
      eyes = `<rect x="32" y="66" width="12" height="20" rx="3" fill="${dark}"/><rect x="84" y="66" width="12" height="20" rx="3" fill="${dark}"/><circle cx="35" cy="70" r="2.5" fill="#fff"/><circle cx="87" cy="70" r="2.5" fill="#fff"/>`;
    } else if (t.expr === 1) {
      eyes = `<rect x="32" y="66" width="12" height="20" rx="3" fill="${dark}"/><circle cx="35" cy="70" r="2.5" fill="#fff"/><path d="M 82 76 Q 90 70 98 76" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    } else if (t.expr === 2) {
      eyes = `<rect x="24" y="64" width="36" height="18" rx="3" fill="#111"/><rect x="68" y="64" width="36" height="18" rx="3" fill="#111"/><rect x="56" y="68" width="16" height="4" fill="#111"/><line x1="28" y1="67" x2="52" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/><line x1="72" y1="67" x2="96" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>`;
    } else {
      eyes = `<polygon points="38,62 41,71 50,71 43,76 46,85 38,80 30,85 33,76 26,71 35,71" fill="#ffd700"/><polygon points="90,62 93,71 102,71 95,76 98,85 90,80 82,85 85,76 78,71 87,71" fill="#ffd700"/>`;
    }

    let acc = "";
    if (t.acc === 1) acc = `<polygon points="64,4 48,32 80,32" fill="#ff4757" stroke="#ffd700" stroke-width="3"/><circle cx="64" cy="4" r="5" fill="#ffd700"/>`;
    else if (t.acc === 2) acc = `<polygon points="46,26 46,14 55,20 64,10 73,20 82,14 82,26" fill="#ffd700" stroke="#b7791f" stroke-width="2"/><circle cx="64" cy="10" r="3" fill="#e74c3c"/>`;
    else if (t.acc === 3) acc = `<ellipse cx="64" cy="12" rx="30" ry="8" fill="none" stroke="#ffeaa7" stroke-width="5"/>`;
    else if (t.acc === 4) acc = `<polygon points="56,116 64,120 56,124" fill="#e74c3c"/><polygon points="72,116 64,120 72,124" fill="#e74c3c"/><circle cx="64" cy="120" r="3" fill="#c0392b"/>`;
    else if (t.acc === 5) acc = `<circle cx="114" cy="100" r="12" fill="#00d2d3" opacity="0.85"/><circle cx="111" cy="97" r="4" fill="#fff" opacity="0.9"/>`;

    const defs = `<defs><linearGradient id="body" x1="20" y1="30" x2="104" y2="132"><stop offset="0%" stop-color="#fff" stop-opacity=".34"/><stop offset="32%" stop-color="${body}"/><stop offset="100%" stop-color="${dark}" stop-opacity=".28"/></linearGradient><radialGradient id="shine" cx="35%" cy="26%" r="58%"><stop offset="0%" stop-color="#fff" stop-opacity=".42"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`;
    const bodyLayer = t.species === 1
      ? shell
      : t.species === 2
        ? `<path d="M30 48 H98 Q106 48 106 56 V78 Q106 86 98 86 H30 Q22 86 22 78 V56 Q22 48 30 48 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/><path d="M38 88 H90 Q99 88 101 98 L104 119 Q105 129 95 131 H33 Q23 129 24 119 L27 98 Q29 88 38 88 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
        : t.species === 3
          ? `<path d="M31 72 C29 48 43 35 64 38 C85 35 99 48 97 72 L94 105 C91 127 78 137 64 134 C50 137 37 127 34 105 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
          : t.species === 4
            ? `<path d="M20 73 C18 50 35 37 59 38 H74 C96 38 109 52 107 75 L103 105 C99 127 82 137 61 133 C38 135 22 121 20 98 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
            : t.species === 5
              ? `<path d="M22 74 C20 49 38 35 64 36 C90 35 108 49 106 74 L104 99 C102 124 88 138 64 135 C40 138 26 124 24 99 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
              : t.species === 6
                ? `<path d="M14 82 C14 58 34 47 64 48 C94 47 114 58 114 82 C114 115 94 134 64 131 C34 134 14 115 14 82 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
                : t.species === 7
                  ? shell
                  : `<path d="M22 68 C19 44 38 30 64 34 C90 30 109 44 106 68 L102 101 C100 125 84 137 62 133 C38 137 22 122 22 98 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`;
    const speciesLayer = species;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="128" height="148">${defs}<rect width="128" height="148" fill="${bg}"/>${habitat}<ellipse cx="64" cy="137" rx="45" ry="8" fill="${dark}" opacity=".24"/><g><animateTransform attributeName="transform" type="translate" values="${motionValues}" dur="${motionDur}" repeatCount="indefinite"/>${ears}${limbs}${bodyLayer}${shine}<rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/><rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>${eyes}<rect x="60" y="96" width="8" height="5" rx="2" fill="${dark}"/>${speciesLayer}${acc}</g></svg>`;
  }

  function attributes(t) {
    const pal = PALETTE[t.palette];
    return [
      ["Species", SPECIES[t.species]],
      ["Palette", pal[3]],
      ["Rarity Tier", pal[4]],
      ["Expression", EXPR[t.expr]],
      ["Accessory", ACC[t.acc]],
      ["Era", ERA[t.era]],
      ["Habitat", HABITAT[t.habitat]],
      ["Motion", MOTION[t.motion]],
    ];
  }

  // --- ui ---
  const grid = document.getElementById("grid");
  const stat = document.getElementById("stat");
  const bar = document.getElementById("bar");
  const barFill = bar.querySelector("i");
  const logEl = document.getElementById("log");
  const addrInput = document.getElementById("nftAddr");
  const modal = document.getElementById("modal");

  const cards = [];

  const params = new URLSearchParams(location.search);
  // API base: ?api= override wins; otherwise stay same-origin on localhost (the relay
  // serves this page under /web/), else use the app's configured server (production).
  const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  const apiBase = (params.get("api") || (isLocal ? "" : (window.TINYFRENS_SERVER || ""))).replace(/\/$/, "");
  if (params.get("nft")) addrInput.value = params.get("nft");
  else if (localStorage.getItem("tf_nft")) addrInput.value = localStorage.getItem("tf_nft");

  const onchainById = {};

  function buildGrid() {
    const frag = document.createDocumentFragment();
    for (let id = 1; id <= MAX_SUPPLY; id++) {
      const t = traitsFor(id);
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.id = id;
      card.innerHTML = `<span class="badge">on-chain</span>${art(t)}<div class="id">#${id} · ${SPECIES[t.species]}</div>`;
      card.addEventListener("click", () => openModal(id, traitsFor(id), onchainById[id]));
      frag.appendChild(card);
      cards.push(card);
    }
    grid.appendChild(frag);
    stat.textContent = `${MAX_SUPPLY} previews`;
  }

  function openModal(id, t, onchain) {
    const artHtml = onchain && onchain.image ? `<img src="${onchain.image}" alt="TinyFren #${id}"/>` : art(t);
    document.getElementById("modalArt").innerHTML = artHtml;
    document.title = onchain && onchain.name ? onchain.name : `TinyFren #${id}`;
    document.getElementById("modalTitle").textContent = (onchain && onchain.name) || `TinyFren #${id}`;
    document.getElementById("modalSub").textContent = (onchain && onchain.description) || `${SPECIES[t.species]} · preview`;
    const traits = onchain && onchain.attributes
      ? onchain.attributes.map((a) => [a.trait_type, a.value])
      : attributes(t);
    document.getElementById("modalTraits").innerHTML = traits.map(([k, v]) => `<span class="tag">${k}: ${v}</span>`).join("");
    const addr = addrInput.value.trim();
    const links = [];
    if (addr) links.push(`<a class="link" href="https://base-sepolia.blockscout.com/token/${addr}/instance/${id}" target="_blank" rel="noopener">View on Blockscout (renders on-chain SVG)</a>`);
    document.getElementById("modalLinks").innerHTML = links.join("<br>");
    modal.classList.add("on");
  }

  // prevrandao-free deterministic seed so previews are stable across reloads.
  // (On-chain art is fixed at mint; use Load on-chain for exact output.)
  function decodeTokenUri(uri) {
    if (!uri || !uri.startsWith("data:application/json")) return null;
    const b64 = uri.slice(uri.indexOf(",") + 1);
    try {
      const json = JSON.parse(atob(b64));
      return json;
    } catch { return null; }
  }

  async function loadOnchain() {
    const addr = addrInput.value.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) { logEl.textContent = "Enter a valid 0x collection address first."; return; }
    localStorage.setItem("tf_nft", addr);
    const btn = document.getElementById("loadBtn");
    btn.disabled = true;
    bar.classList.add("on");
    logEl.textContent = "Reading tokenURI from the collection…";
    let minted = 0, done = 0, errors = 0;
    const limit = 8;
    let next = 1;
    async function worker() {
      while (next <= MAX_SUPPLY) {
        const id = next++;
        try {
          const r = await fetch(`${apiBase}/api/nft/uri?tokenId=${id}`);
          const data = await r.json();
          if (data.minted && data.uri) {
            const json = decodeTokenUri(data.uri);
            if (json) {
              minted++;
              onchainById[id] = json;
              const card = cards[id - 1];
              card.classList.add("minted");
              if (json.image) card.querySelector("svg").outerHTML = `<img src="${json.image}" alt="#${id}"/>`;
              card.querySelector(".id").textContent = `#${id} · ${json.name || SPECIES[traitsFor(id).species]}`;
            }
          }
        } catch { errors++; }
        done++;
        if (done % 6 === 0 || done === MAX_SUPPLY) barFill.style.width = `${(done / MAX_SUPPLY) * 100}%`;
      }
    }
    await Promise.all(Array.from({ length: limit }, worker));
    bar.classList.remove("on");
    btn.disabled = false;
    stat.textContent = `${minted} on-chain · ${MAX_SUPPLY - minted} preview`;
    logEl.textContent = `Loaded ${minted} minted token(s)${errors ? `, ${errors} request error(s)` : ""}. Cards with a gold border are live on-chain.`;
  }

  document.getElementById("loadBtn").addEventListener("click", loadOnchain);
  document.getElementById("previewBtn").addEventListener("click", () => {
    for (const card of cards) { card.classList.remove("minted"); }
    stat.textContent = `${MAX_SUPPLY} previews`;
    logEl.textContent = "Preview mode (client-side art).";
  });
  document.getElementById("closeModal").addEventListener("click", () => modal.classList.remove("on"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("on"); });

  buildGrid();
})();
