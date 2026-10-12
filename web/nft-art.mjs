export const NFT_SPECIES = ["Robot"];
export const NFT_SHAPES = ["robot"];
export const NFT_PALETTES = [
  ["#a474f1", "#302048", "#17142a", "Lavender Dream", "Classic"],
  ["#66c7d2", "#183d4d", "#102c38", "Cyber Neon", "Classic"],
  ["#ffb95e", "#623b29", "#382a38", "Sunny Amber", "Classic"],
  ["#82eba1", "#24533f", "#193c3a", "Mint Meadow", "Classic"],
  ["#ff82a7", "#632b48", "#3b213b", "Bubblegum", "Classic"],
  ["#4d96ff", "#263a6a", "#182d50", "Electric Blue", "Classic"],
  ["#76638e", "#241d38", "#211c39", "Midnight Obsidian", "Rare"],
  ["#ffd700", "#6c421c", "#2d2238", "24K Solid Gold", "Legendary"],
];

const box = (x, y, width, height, color) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}"/>`;

function habitat(index, background) {
  const scene = box(0, 0, 64, 64, background) + box(0, 49, 64, 15, "#263446");
  switch (index) {
    case 0: return scene + box(7, 9, 2, 2, "#f3e9b6") + box(50, 16, 1, 1, "#f3e9b6") + box(0, 50, 64, 2, "#536480");
    case 1: return scene + box(4, 9, 9, 21, "#1a314c") + box(49, 7, 10, 25, "#203452") +
      box(6, 13, 3, 3, "#f597b8") + box(52, 11, 3, 3, "#69e5dc") +
      box(2, 55, 14, 2, "#65d5cd") + box(29, 55, 14, 2, "#65d5cd");
    case 2: return scene + box(0, 47, 64, 17, "#305444") + box(5, 47, 3, 3, "#f5b258") +
      box(54, 45, 3, 3, "#f597b8") + box(7, 44, 1, 3, "#80cf83") + box(55, 43, 1, 3, "#80cf83");
    case 3: return scene + box(5, 12, 15, 3, "#c4a2ce") + box(39, 17, 16, 3, "#c4a2ce") +
      box(9, 10, 7, 3, "#c4a2ce") + box(44, 15, 7, 3, "#c4a2ce") + box(0, 52, 64, 2, "#817197");
    case 4: return scene + box(4, 8, 11, 18, "#352944") + box(49, 10, 10, 16, "#352944") +
      box(6, 10, 7, 3, "#eebf60") + box(51, 12, 6, 3, "#7bdde2") + box(0, 54, 64, 2, "#a761a0");
    default: return scene + box(0, 48, 64, 16, "#3a6247") + box(9, 43, 2, 5, "#94bc64") +
      box(8, 42, 4, 2, "#eecb73") + box(52, 44, 2, 4, "#94bc64") + box(51, 43, 4, 2, "#ee92a7");
  }
}

function eyes(expression, left, right, y, ink) {
  if (expression === 1) return box(left, y, 2, 3, ink) + box(right, y + 2, 3, 1, ink);
  if (expression === 2) return box(left - 1, y, 6, 3, "#10141e") + box(right - 1, y, 6, 3, "#10141e") +
    box(left + 1, y, 2, 1, "#9be7e6");
  if (expression === 3) return box(left, y, 3, 3, "#ffe078") + box(right, y, 3, 3, "#ffe078") +
    box(left + 1, y + 1, 1, 1, ink) + box(right + 1, y + 1, 1, 1, ink);
  return box(left, y, 2, 3, ink) + box(right, y, 2, 3, ink) +
    box(left, y, 1, 1, "#ffffff") + box(right, y, 1, 1, "#ffffff");
}

function feet(species, ink, body) {
  const left = species === 3 ? 23 : 21;
  const right = 38;
  const y = species === 2 ? 46 : 45;
  return `<g class="foot-a">${box(left, y, 6, 6, ink)}${box(left + 1, y, 4, 4, body)}</g>` +
    `<g class="foot-b">${box(right, y, 6, 6, ink)}${box(right + 1, y, 4, 4, body)}</g>`;
}

function cat(body, ink, expression) {
  return box(45, 35, 5, 3, ink) + box(48, 31, 3, 5, ink) + box(47, 28, 3, 4, ink) +
    box(16, 15, 7, 12, ink) + box(39, 15, 7, 12, ink) +
    box(18, 17, 4, 9, body) + box(40, 17, 4, 9, body) +
    box(19, 20, 2, 4, "#f6a3b3") + box(41, 20, 2, 4, "#f6a3b3") +
    box(17, 25, 29, 20, ink) + box(19, 27, 25, 15, body) +
    box(23, 38, 17, 6, "#f5d8bd") + eyes(expression, 24, 37, 31, ink) +
    box(30, 38, 3, 2, ink) + box(12, 38, 8, 1, ink) + box(43, 38, 8, 1, ink) +
    box(13, 41, 7, 1, ink) + box(43, 41, 7, 1, ink) + feet(0, ink, body);
}

function robot(body, ink, expression) {
  return box(31, 10, 2, 5, ink) + box(29, 8, 6, 3, "#f0bd5e") + box(31, 7, 2, 1, "#ffe078") +
    box(17, 18, 30, 24, ink) + box(19, 20, 26, 20, body) +
    box(16, 24, 3, 8, "#6bdce3") + box(45, 24, 3, 8, "#6bdce3") +
    box(22, 23, 20, 12, "#192a41") + eyes(expression, 26, 36, 27, "#79e3e3") +
    box(25, 36, 14, 2, ink) + box(30, 36, 4, 1, "#f0bd5e") +
    box(21, 41, 22, 4, ink) + box(23, 41, 18, 2, "#2b4767") +
    `<g class="arm-a">${box(12, 27, 5, 11, ink)}${box(13, 30, 3, 6, body)}${box(11, 38, 5, 3, "#f0bd5e")}</g>` +
    `<g class="arm-b">${box(47, 27, 5, 11, ink)}${box(48, 30, 3, 6, body)}${box(48, 38, 5, 3, "#f0bd5e")}</g>` +
    feet(1, ink, body);
}

function frog(body, ink, expression) {
  return box(16, 17, 11, 12, ink) + box(37, 17, 11, 12, ink) +
    box(18, 19, 7, 8, body) + box(39, 19, 7, 8, body) +
    box(16, 26, 32, 20, ink) + box(18, 28, 28, 15, body) +
    box(22, 38, 20, 6, "#d0e5a5") + eyes(expression, 21, 41, 22, ink) +
    box(22, 35, 3, 2, ink) + box(39, 35, 3, 2, ink) +
    box(25, 38, 14, 1, ink) + box(19, 39, 2, 2, "#f3a19c") +
    box(43, 39, 2, 2, "#f3a19c") + feet(2, ink, body);
}

function turtle(body, ink, expression) {
  return box(12, 36, 6, 3, ink) + box(15, 39, 5, 2, ink) +
    box(17, 28, 30, 19, ink) + box(20, 25, 23, 4, ink) +
    box(20, 29, 25, 15, body) + box(25, 26, 15, 3, body) +
    box(29, 30, 3, 13, ink) + box(21, 36, 23, 2, ink) +
    box(23, 31, 4, 3, "#f1d48f") + box(35, 31, 4, 3, "#f1d48f") +
    box(46, 31, 11, 13, ink) + box(48, 29, 7, 3, ink) +
    box(48, 33, 9, 9, "#91d890") + box(54, 36, 6, 5, "#91d890") +
    box(55, 41, 5, 2, ink) + eyes(expression, 52, 57, 34, ink) +
    feet(3, ink, "#91d890");
}

function accessory(index, species) {
  const top = 15;
  const center = 32;
  if (index === 1) return box(center - 5, top - 4, 10, 2, "#f16d72") +
    box(center - 3, top - 8, 6, 4, "#f16d72") + box(center - 1, top - 10, 2, 2, "#ffe078");
  if (index === 2) return box(center - 6, top - 4, 12, 3, "#e6b84b") +
    box(center - 5, top - 8, 2, 4, "#e6b84b") + box(center - 1, top - 9, 2, 5, "#e6b84b") +
    box(center + 3, top - 8, 2, 4, "#e6b84b");
  if (index === 3) return box(center - 7, top - 8, 14, 2, "#fbe9aa") +
    box(center - 7, top - 7, 2, 2, "#fbe9aa") + box(center + 5, top - 7, 2, 2, "#fbe9aa");
  if (index === 4) {
    const neck = 41;
    return box(center - 4, neck, 3, 3, "#ec6c7c") +
      box(center + 1, neck, 3, 3, "#ec6c7c") + box(center - 1, neck + 1, 2, 2, "#f9d77d");
  }
  if (index === 5) return box(49, 37, 5, 5, "#69dce3") + box(50, 38, 2, 2, "#ffffff");
  return "";
}

function eraMark(era) {
  if (era === 0) return box(3, 4, 2, 2, "#dc9979");
  if (era === 1) return box(3, 4, 2, 2, "#b9c5dc") + box(7, 4, 2, 2, "#b9c5dc");
  return box(3, 4, 2, 2, "#ffe078") + box(7, 4, 2, 2, "#ffe078") +
    box(11, 4, 2, 2, "#ffe078");
}

export function renderNftArt(traits, stage = 0) {
  const [body, ink, background] = NFT_PALETTES[traits.palette];
  const sprite = robot(body, ink, traits.expr);
  const duration = ["0.72s", "0.48s", "1.1s", "0.4s"][traits.motion];
  const style = `<style>.body{animation:bob ${duration} steps(1) infinite}.foot-a{animation:step-a ${duration} steps(1) infinite}.foot-b{animation:step-b ${duration} steps(1) infinite}.arm-a{animation:arm-a ${duration} steps(1) infinite}.arm-b{animation:arm-b ${duration} steps(1) infinite}@keyframes bob{0%,100%{transform:translateY(0)}25%,75%{transform:translateY(-1px)}50%{transform:translateY(-2px)}}@keyframes step-a{0%,100%{transform:translate(0,0)}25%{transform:translate(2px,-2px)}50%{transform:translate(0,0)}75%{transform:translate(-2px,0)}}@keyframes step-b{0%,100%{transform:translate(0,0)}25%{transform:translate(-2px,0)}50%{transform:translate(0,0)}75%{transform:translate(2px,-2px)}}@keyframes arm-a{0%,100%{transform:translate(0,0)}25%,75%{transform:translate(0,2px)}50%{transform:translate(-1px,0)}}@keyframes arm-b{0%,100%{transform:translate(0,2px)}25%,75%{transform:translate(0,0)}50%{transform:translate(1px,2px)}}@media(prefers-reduced-motion:reduce){.body,.foot-a,.foot-b,.arm-a,.arm-b{animation:none}}</style>`;
  const evolution = stage ? box(4, 4, 2, 2, "#ffe078") + box(57, 9, 2, 2, "#ffe078") : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%" shape-rendering="crispEdges" data-species="${traits.species}">${style}${habitat(traits.habitat, background)}${eraMark(traits.era)}${box(17, 50, 32, 2, "#17212d")}<g class="body">${sprite}${accessory(traits.acc, traits.species)}</g>${evolution}</svg>`;
}
