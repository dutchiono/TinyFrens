import { renderNftArt } from "./nft-art.mjs";
import { ROBOT_COLLECTION } from "./robot-collection.mjs";

document.querySelector("h1").textContent = ROBOT_COLLECTION.name;
document.title = `${ROBOT_COLLECTION.name} · Art preview`;

const base = { species: 0, palette: 0, expr: 0, acc: 0, era: 0, habitat: 0, motion: 0, ambience: 0 };
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

["Antenna", "Pilot helmet", "Crown", "Halo", "Bow tie", "Floating orb"].forEach((label, acc) => add("accessories", label, { acc }));
["Moonlit plaza", "Neon crosswalk", "Snack garden", "Cloud terrace", "Arcade alley", "Tiny meadow"].forEach((label, habitat) => add("habitats", label, { habitat, palette: habitat, acc: 2 }));
["Happy walk", "Bouncy strut", "Sleepy drift", "Excited wiggle"].forEach((label, motion) => add("walks", label, { motion, habitat: 1, palette: 1 }));

["Easy / sparkling", "Brisk / lively", "Swift / soft", "Lazy / dreamy"].forEach((label, i) => add("ambience", label, { habitat: 0, acc: 5, ambience: i * 21845 }));

function draw() {
  for (const { image, traits } of cards) {
    let svg = renderNftArt(traits);
    if (paused) svg = svg.replace("</style>", ".body,.foot-a,.foot-b,.arm-a,.arm-b,.drift,.twinkle,.glow,.sway,.leaf,.shadow,.parallax,.light,.sheen,.orb,.halo{animation:none}</style>");
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  const button = document.getElementById("motion");
  button.textContent = paused ? "Play animation" : "Pause animation";
  button.setAttribute("aria-pressed", String(paused));
}
document.getElementById("motion").addEventListener("click", () => { paused = !paused; draw(); });
draw();
