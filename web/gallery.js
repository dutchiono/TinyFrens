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
    let ears = "", bodyRadius = 'rx="38" ry="32"', shell = "", species = "";
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
      ears = `<polygon points="20,40 36,4 52,40" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><polygon points="76,40 92,4 108,40" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>`;
      species = `<path d="M112 116 C136 105 122 80 104 92" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/><path d="M25 93 H10 M103 93 H118" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>`;
    } else if (t.species === 1) {
      bodyRadius = 'rx="48" ry="40"';
      species = `<path d="M26 52 C15 76 14 114 36 129 C50 139 54 124 66 130 C88 141 115 119 112 86 C109 51 91 41 69 48 C50 37 35 36 26 52 Z" fill="${body}" stroke="${dark}" stroke-width="8"/>`;
    } else if (t.species === 2) {
      ears = `<rect x="60" y="8" width="8" height="24" fill="${dark}"/><circle cx="64" cy="8" r="6" fill="${body}" stroke="${dark}" stroke-width="3"/>`;
      bodyRadius = 'rx="8" ry="8"';
      species = `<rect x="20" y="120" width="88" height="10" rx="2" fill="${dark}" opacity="0.28"/><circle cx="22" cy="82" r="5" fill="${dark}"/><circle cx="106" cy="82" r="5" fill="${dark}"/>`;
    } else if (t.species === 3) {
      ears = `<rect x="26" y="2" width="20" height="50" rx="10" fill="${body}" stroke="${dark}" stroke-width="7"/><rect x="82" y="2" width="20" height="50" rx="10" fill="${body}" stroke="${dark}" stroke-width="7"/>`;
      species = `<rect x="58" y="101" width="5" height="9" rx="1" fill="#fff"/><rect x="65" y="101" width="5" height="9" rx="1" fill="#fff"/>`;
    } else if (t.species === 4) {
      ears = `<rect x="6" y="38" width="24" height="42" rx="10" transform="rotate(-25 6 38)" fill="${body}" stroke="${dark}" stroke-width="7"/><rect x="98" y="28" width="24" height="42" rx="10" transform="rotate(25 98 28)" fill="${body}" stroke="${dark}" stroke-width="7"/>`;
      species = `<ellipse cx="64" cy="98" rx="21" ry="15" fill="#fff" opacity="0.35"/><circle cx="64" cy="94" r="5" fill="${dark}"/>`;
    } else if (t.species === 5) {
      ears = `<circle cx="28" cy="30" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="100" cy="30" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/>`;
      species = `<ellipse cx="64" cy="101" rx="24" ry="17" fill="#fff" opacity="0.3"/><circle cx="64" cy="96" r="5" fill="${dark}"/>`;
    } else if (t.species === 6) {
      ears = `<circle cx="34" cy="32" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="94" cy="32" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="34" cy="32" r="5" fill="#fff"/><circle cx="94" cy="32" r="5" fill="#fff"/><circle cx="34" cy="32" r="2.5" fill="${dark}"/><circle cx="94" cy="32" r="2.5" fill="${dark}"/>`;
      bodyRadius = 'rx="46" ry="38"';
      species = `<path d="M38 101 Q64 116 90 101" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    } else {
      bodyRadius = 'rx="48" ry="40"';
      shell = `<ellipse cx="64" cy="86" rx="38" ry="33" fill="none" stroke="${dark}" stroke-width="6"/><path d="M32 86 H96 M64 53 V119 M42 62 Q64 80 86 62 M42 110 Q64 92 86 110" stroke="${dark}" stroke-width="3" fill="none" opacity="0.75"/>`;
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
    const limbs = `<path d="M16 84 C5 94 8 111 22 112" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/><path d="M112 84 C123 94 120 111 106 112" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/><path d="M31 128 C36 121 45 121 50 129 L50 137 H25 L25 132 C25 130 27 129 31 128 Z" fill="${dark}"/><path d="M78 129 C83 121 92 121 98 128 C102 129 104 131 104 134 L104 137 H78 Z" fill="${dark}"/>`;
    const bodyLayer = t.species === 1
      ? species
      : t.species === 2
        ? `<rect x="12" y="34" width="104" height="98" ${bodyRadius} fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
        : t.species === 3
          ? `<path d="M28 70 C24 46 40 30 64 34 C88 30 104 46 100 70 L98 100 C96 124 82 136 64 134 C46 136 32 124 30 100 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
          : t.species === 4
            ? `<path d="M18 72 C18 50 34 37 59 38 H76 C96 38 110 53 108 76 L103 104 C99 126 82 137 60 133 C36 135 20 120 18 96 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
            : t.species === 5
              ? `<path d="M20 72 C18 48 36 34 64 35 C92 34 110 48 108 72 L106 98 C104 124 88 138 64 135 C40 138 24 124 22 98 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
              : t.species === 6
                ? `<path d="M14 80 C14 54 34 43 64 45 C94 43 114 54 114 80 C114 116 94 136 64 132 C34 136 14 116 14 80 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
                : t.species === 7
                  ? `<path d="M16 86 C16 58 36 44 64 46 C92 44 112 58 112 86 C112 114 92 132 64 132 C36 132 16 114 16 86 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
                  : `<path d="M22 68 C19 44 38 30 64 34 C90 30 109 44 106 68 L102 101 C100 125 84 137 62 133 C38 137 22 122 22 98 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`;
    const speciesLayer = t.species === 1 ? "" : species;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="128" height="148">${defs}<rect width="128" height="148" fill="${bg}"/>${habitat}<ellipse cx="64" cy="137" rx="45" ry="8" fill="${dark}" opacity=".24"/><g><animateTransform attributeName="transform" type="translate" values="${motionValues}" dur="${motionDur}" repeatCount="indefinite"/>${ears}${limbs}${bodyLayer}<ellipse cx="42" cy="55" rx="18" ry="14" fill="url(#shine)"/>${shell}<rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/><rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>${eyes}<rect x="60" y="96" width="8" height="5" rx="2" fill="${dark}"/>${speciesLayer}${acc}</g></svg>`;
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
