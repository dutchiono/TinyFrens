import { renderNftArt } from "./nft-art.mjs";

const base = { species: 0, palette: 0, expr: 0, acc: 0, era: 0, habitat: 0, motion: 0 };
const cards = [];
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;

function add(group, label, overrides) {
  const figure = document.createElement("figure");
  figure.className = "card";
  const image = document.createElement("img");
  image.alt = label;
  const caption = document.createElement("figcaption");
  caption.textContent = label;
  figure.append(image, caption);
  document.getElementById(group).append(figure);
  cards.push({ image, traits: { ...base, ...overrides } });
}

["Antenna", "Party hat", "Crown", "Halo", "Bow tie", "Floating orb"].forEach((label, acc) => add("accessories", label, { acc }));
["Moonlit plaza", "Neon crosswalk", "Snack garden", "Cloud room", "Arcade alley", "Tiny meadow"].forEach((label, habitat) => add("habitats", label, { habitat, palette: habitat, acc: 2 }));
["Happy walk", "Bouncy strut", "Sleepy drift", "Excited wiggle"].forEach((label, motion) => add("walks", label, { motion, habitat: 1, palette: 1 }));

function draw() {
  for (const { image, traits } of cards) {
    let svg = renderNftArt(traits);
    if (paused) svg = svg.replace("</style>", ".body,.foot-a,.foot-b,.arm-a,.arm-b,.drift,.twinkle,.glow,.sway,.leaf,.shadow{animation:none}</style>");
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  const button = document.getElementById("motion");
  button.textContent = paused ? "Play animation" : "Pause animation";
  button.setAttribute("aria-pressed", String(paused));
}
document.getElementById("motion").addEventListener("click", () => { paused = !paused; draw(); });
draw();
