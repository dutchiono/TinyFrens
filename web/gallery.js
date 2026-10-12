import { NFT_PALETTES, NFT_SHAPES, NFT_SPECIES, renderNftArt } from "./nft-art.mjs";

const MAX_SUPPLY = 2664;
const EXPR = ["Classic Happy", "Playful Wink", "Cool Shades", "Star Eyes"];
const ACC = ["None", "Party Hat", "Royal Crown", "Angel Halo", "Dapper Bow Tie", "Mystic Orb"];
const ERA = ["Pocket Genesis", "Street Wanderers", "Dream Garden"];
const HABITAT = ["Moonlit Plaza", "Neon Crosswalk", "Snack Garden", "Cloud Room", "Arcade Alley", "Tiny Meadow"];
const MOTION = ["Happy Walk", "Bouncy Strut", "Sleepy Drift", "Excited Wiggle"];

function traitsFor(tokenId) {
  const artIndex = ((tokenId - 1) % 888 * 197 + 17) % 4608;
  const combination = Math.floor(artIndex / 8);
  return {
    species: 0,
    palette: artIndex % NFT_PALETTES.length,
    expr: combination % 4,
    acc: Math.floor(combination / 4) % 6,
    era: Math.floor((tokenId - 1) / 888),
    habitat: Math.floor(combination / 24) % 6,
    motion: Math.floor(combination / 144) % 4,
  };
}

function attributes(traits) {
  return [
    ["Species", NFT_SPECIES[traits.species]],
    ["Palette", NFT_PALETTES[traits.palette][3]],
    ["Rarity Tier", NFT_PALETTES[traits.palette][4]],
    ["Expression", EXPR[traits.expr]],
    ["Accessory", ACC[traits.acc]],
    ["Era", ERA[traits.era]],
    ["Habitat", HABITAT[traits.habitat]],
    ["Motion", MOTION[traits.motion]],
  ];
}

const grid = document.getElementById("grid");
const stat = document.getElementById("stat");
const progress = document.getElementById("bar");
const progressFill = progress.querySelector("i");
const log = document.getElementById("log");
const address = document.getElementById("nftAddr");
const modal = document.getElementById("modal");
const cards = new Map();
const onchainById = new Map();
const params = new URLSearchParams(location.search);
const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
const apiBase = (params.get("api") || (isLocal ? "" : (window.TINYFRENS_SERVER || ""))).replace(/\/$/, "");
address.value = params.get("nft") || localStorage.getItem("tf_nft") || "0x695a9a01C4e4659327bBb4f157E5c08F05bDde2e";

let selectedSpecies = "all";
let visibleIds = Array.from({ length: MAX_SUPPLY }, (_, index) => index + 1);
let nextIndex = 0;
let inspected = null;

function cardFor(tokenId) {
  const traits = traitsFor(tokenId);
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.id = tokenId;
  card.innerHTML = `<span class="badge">preview</span>${renderNftArt(traits)}<div class="id">#${tokenId} · ${NFT_SPECIES[traits.species]}</div>`;
  card.addEventListener("click", () => openModal(tokenId));
  const metadata = onchainById.get(tokenId);
  if (metadata) setOnchainCard(card, tokenId, metadata);
  return card;
}

function setOnchainCard(card, tokenId, metadata) {
  card.classList.add("minted");
  card.querySelector(".badge").textContent = "on-chain";
  if (metadata.image) {
    const image = document.createElement("img");
    image.src = metadata.image;
    image.alt = `TinyFren #${tokenId}`;
    card.querySelector("svg")?.replaceWith(image);
  }
  card.querySelector(".id").textContent = `#${tokenId} · ${metadata.name || NFT_SPECIES[traitsFor(tokenId).species]}`;
}

function renderNext() {
  const fragment = document.createDocumentFragment();
  for (const tokenId of visibleIds.slice(nextIndex, nextIndex + 48)) {
    const card = cardFor(tokenId);
    cards.set(tokenId, card);
    fragment.appendChild(card);
  }
  nextIndex += 48;
  grid.appendChild(fragment);
  stat.textContent = `${Math.min(nextIndex, visibleIds.length)} of ${visibleIds.length} previews`;
  loadMore.hidden = nextIndex >= visibleIds.length;
}

const loadMore = document.createElement("button");
loadMore.type = "button";
loadMore.className = "secondary";
loadMore.textContent = "Show 48 more";
loadMore.style.margin = "18px auto 28px";
loadMore.style.display = "block";
loadMore.addEventListener("click", renderNext);
grid.after(loadMore);

function resetGrid() {
  grid.replaceChildren();
  cards.clear();
  visibleIds = Array.from({ length: MAX_SUPPLY }, (_, index) => index + 1)
    .filter(() => selectedSpecies === "all" || selectedSpecies === "0");
  nextIndex = 0;
  renderNext();
}

function openModal(tokenId) {
  const traits = traitsFor(tokenId);
  const metadata = onchainById.get(tokenId);
  inspected = { tokenId, traits };
  document.getElementById("modalArt").innerHTML = metadata?.image
    ? `<img src="${metadata.image}" alt="TinyFren #${tokenId}"/>`
    : renderNftArt(traits);
  document.title = metadata?.name || `TinyFren #${tokenId}`;
  document.getElementById("modalTitle").textContent = document.title;
  document.getElementById("modalSub").textContent = metadata?.description || `${NFT_SPECIES[traits.species]} · preview`;
  const traitsElement = document.getElementById("modalTraits");
  traitsElement.replaceChildren();
  for (const [key, value] of metadata?.attributes?.map((attribute) => [attribute.trait_type, attribute.value]) || attributes(traits)) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${key}: ${value}`;
    traitsElement.appendChild(tag);
  }
  const collection = address.value.trim();
  document.getElementById("modalLinks").innerHTML = /^0x[a-fA-F0-9]{40}$/.test(collection)
    ? `<a class="link" href="https://base-sepolia.blockscout.com/token/${collection}/instance/${tokenId}" target="_blank" rel="noopener">View on Blockscout</a>`
    : "";
  modal.classList.add("on");
}

function decodeTokenUri(uri) {
  if (!uri?.startsWith("data:application/json")) return null;
  try { return JSON.parse(atob(uri.slice(uri.indexOf(",") + 1))); }
  catch { return null; }
}

async function loadOnchain() {
  const collection = address.value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(collection)) {
    log.textContent = "Enter a valid 0x collection address first.";
    return;
  }
  localStorage.setItem("tf_nft", collection);
  const button = document.getElementById("loadBtn");
  button.disabled = true;
  progress.classList.add("on");
  log.textContent = "Reading tokenURI from the collection…";
  let next = 1;
  let done = 0;
  let errors = 0;
  async function worker() {
    while (next <= MAX_SUPPLY) {
      const tokenId = next++;
      try {
        const response = await fetch(`${apiBase}/api/nft/uri?tokenId=${tokenId}`);
        const data = await response.json();
        const metadata = data.minted ? decodeTokenUri(data.uri) : null;
        if (metadata) {
          onchainById.set(tokenId, metadata);
          const card = cards.get(tokenId);
          if (card) setOnchainCard(card, tokenId, metadata);
        }
      } catch { errors++; }
      done++;
      if (done % 6 === 0 || done === MAX_SUPPLY) progressFill.style.width = `${done / MAX_SUPPLY * 100}%`;
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  progress.classList.remove("on");
  button.disabled = false;
  log.textContent = `Loaded ${onchainById.size} minted token(s)${errors ? `, ${errors} request error(s)` : ""}.`;
}

document.getElementById("loadBtn").addEventListener("click", loadOnchain);
document.getElementById("previewBtn").addEventListener("click", () => {
  onchainById.clear();
  resetGrid();
  log.textContent = "Preview mode (client-side art).";
});
document.getElementById("closeModal").addEventListener("click", () => modal.classList.remove("on"));
modal.addEventListener("click", (event) => { if (event.target === modal) modal.classList.remove("on"); });
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") modal.classList.remove("on");
});
document.getElementById("adoptFrenBtn").addEventListener("click", () => {
  if (!inspected) return;
  const { tokenId, traits } = inspected;
  let state = {};
  try { state = JSON.parse(localStorage.getItem("pocket-familiar-v1")) || {}; } catch {}
  state.shape = NFT_SHAPES[traits.species];
  state.color = NFT_PALETTES[traits.palette][0];
  state.expression = ["happy", "wink", "shades", "star_eyes"][traits.expr];
  state.accessory = ["none", "party_hat", "crown", "halo", "bow_tie", "orb"][traits.acc];
  state.tokenId = tokenId;
  state.feedback = `Adopted ${NFT_SPECIES[traits.species]} #${tokenId} look from Gallery!`;
  localStorage.setItem("pocket-familiar-v1", JSON.stringify(state));
  window.location.href = "./#pet";
});
for (const chip of document.querySelectorAll(".species-chip")) {
  chip.addEventListener("click", () => {
    document.querySelector(".species-chip.active")?.classList.remove("active");
    chip.classList.add("active");
    selectedSpecies = chip.dataset.species;
    resetGrid();
  });
}
resetGrid();
