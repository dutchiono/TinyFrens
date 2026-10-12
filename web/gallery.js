// TinyFrens collection gallery.
// Mirrors the on-chain art()/tokenURI() output for local previews and, on demand,
// pulls the exact art from the deployed contract via /api/nft/uri.
(function () {
  "use strict";

  const MAX_SUPPLY = 888;
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
    return t;
  }

  // --- SVG builder (ported from contracts/TinyFrensNFT.sol:art) ---
  function art(t) {
    const pal = PALETTE[t.palette];
    const body = pal[0], dark = pal[1], bg = pal[2];
    let ears = "", bodyRadius = 'rx="38" ry="32"', shell = "";

    if (t.species === 0) {
      ears = `<polygon points="20,40 36,4 52,40" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><polygon points="76,40 92,4 108,40" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>`;
    } else if (t.species === 1) {
      bodyRadius = 'rx="48" ry="40"';
    } else if (t.species === 2) {
      ears = `<rect x="60" y="8" width="8" height="24" fill="${dark}"/><circle cx="64" cy="8" r="6" fill="${body}" stroke="${dark}" stroke-width="3"/>`;
      bodyRadius = 'rx="8" ry="8"';
    } else if (t.species === 3) {
      ears = `<rect x="26" y="2" width="20" height="50" rx="10" fill="${body}" stroke="${dark}" stroke-width="7"/><rect x="82" y="2" width="20" height="50" rx="10" fill="${body}" stroke="${dark}" stroke-width="7"/>`;
    } else if (t.species === 4) {
      ears = `<rect x="6" y="38" width="24" height="42" rx="10" transform="rotate(-25 6 38)" fill="${body}" stroke="${dark}" stroke-width="7"/><rect x="98" y="28" width="24" height="42" rx="10" transform="rotate(25 98 28)" fill="${body}" stroke="${dark}" stroke-width="7"/>`;
    } else if (t.species === 5) {
      ears = `<circle cx="28" cy="30" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="100" cy="30" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/>`;
    } else if (t.species === 6) {
      ears = `<circle cx="34" cy="32" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="94" cy="32" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/><circle cx="34" cy="32" r="5" fill="#fff"/><circle cx="94" cy="32" r="5" fill="#fff"/><circle cx="34" cy="32" r="2.5" fill="${dark}"/><circle cx="94" cy="32" r="2.5" fill="${dark}"/>`;
      bodyRadius = 'rx="46" ry="38"';
    } else {
      bodyRadius = 'rx="48" ry="40"';
      shell = `<circle cx="64" cy="83" r="30" fill="none" stroke="${dark}" stroke-width="4" stroke-dasharray="8 6"/>`;
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

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="128" height="148"><rect width="128" height="148" fill="${bg}"/><rect x="25" y="132" width="29" height="12" rx="4" fill="${dark}"/><rect x="74" y="132" width="29" height="12" rx="4" fill="${dark}"/>${ears}<rect x="9" y="31" width="110" height="105" ${bodyRadius} fill="${body}" stroke="${dark}" stroke-width="8"/>${shell}<rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/><rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>${eyes}<rect x="60" y="96" width="8" height="5" rx="2" fill="${dark}"/>${acc}</svg>`;
  }

  function attributes(t) {
    const pal = PALETTE[t.palette];
    return [
      ["Species", SPECIES[t.species]],
      ["Palette", pal[3]],
      ["Rarity Tier", pal[4]],
      ["Expression", EXPR[t.expr]],
      ["Accessory", ACC[t.acc]],
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
