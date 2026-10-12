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
  switch (index) {
    case 0: return box(0, 0, 64, 64, background) +
      box(0, 49, 64, 15, "#283047") +
      box(0, 49, 64, 2, "#69718d") +
      box(0, 59, 64, 1, "#444a65") +
      box(8, 51, 1, 8, "#444a65") +
      box(48, 51, 1, 8, "#444a65") +
      box(24, 60, 1, 4, "#444a65") +
      box(49, 8, 9, 9, "#f3e9b6") +
      box(47, 6, 8, 8, background) +
      box(6, 14, 2, 2, "#c4b7e9") +
      box(14, 7, 1, 1, "#c4b7e9") +
      box(39, 5, 2, 2, "#c4b7e9") +
      box(59, 28, 1, 1, "#c4b7e9") +
      box(3, 36, 8, 13, "#22283d") +
      box(53, 39, 11, 10, "#22283d") +
      box(5, 39, 2, 3, "#8b7cb4") +
      box(57, 42, 2, 3, "#8b7cb4");
    case 1: return box(0, 0, 64, 64, background) +
      box(0, 48, 64, 16, "#202d42") +
      box(1, 19, 10, 29, "#263652") +
      box(4, 15, 7, 4, "#263652") +
      box(52, 11, 12, 37, "#263652") +
      box(3, 23, 3, 4, "#e8a0cc") +
      box(7, 32, 3, 4, "#e8a0cc") +
      box(54, 16, 3, 4, "#64d9db") +
      box(59, 24, 3, 4, "#64d9db") +
      box(54, 33, 3, 4, "#64d9db") +
      box(0, 48, 64, 2, "#9770ac") +
      box(3, 54, 9, 3, "#b9b2cf") +
      box(17, 54, 9, 3, "#b9b2cf") +
      box(31, 54, 9, 3, "#b9b2cf") +
      box(45, 54, 9, 3, "#b9b2cf") +
      box(59, 54, 5, 3, "#b9b2cf") +
      box(4, 60, 11, 1, "#5fa6b1") +
      box(49, 61, 9, 1, "#c180ae") +
      box(3, 8, 14, 3, "#e783b5");
    case 2: return box(0, 0, 64, 64, background) +
      box(0, 47, 64, 17, "#305444") +
      box(0, 47, 64, 2, "#76a56d") +
      box(0, 59, 64, 5, "#253e36") +
      box(2, 25, 9, 22, "#654a46") +
      box(0, 21, 13, 5, "#aa7476") +
      box(2, 21, 3, 5, "#f1d1aa") +
      box(8, 21, 3, 5, "#f1d1aa") +
      box(3, 30, 6, 7, "#e9be77") +
      box(4, 32, 4, 3, "#dc8069") +
      box(54, 38, 8, 9, "#81594a") +
      box(53, 37, 10, 2, "#b38664") +
      box(56, 31, 2, 6, "#81bf7c") +
      box(53, 30, 4, 3, "#81bf7c") +
      box(57, 28, 4, 3, "#81bf7c") +
      box(58, 26, 2, 2, "#f2a4bb") +
      box(7, 52, 3, 2, "#b0c67c") +
      box(52, 54, 3, 2, "#b0c67c") +
      box(13, 61, 7, 1, "#6b7753");
    case 3: return box(0, 0, 64, 64, background) +
      box(0, 0, 64, 3, "#6b5b86") +
      box(3, 3, 2, 46, "#6b5b86") +
      box(59, 3, 2, 46, "#6b5b86") +
      box(5, 5, 54, 1, "#a994bf") +
      box(5, 27, 54, 2, "#6b5b86") +
      box(12, 5, 2, 22, "#6b5b86") +
      box(49, 5, 2, 22, "#6b5b86") +
      box(6, 15, 13, 3, "#e2cde4") +
      box(9, 13, 6, 2, "#e2cde4") +
      box(42, 10, 15, 3, "#e2cde4") +
      box(46, 8, 7, 2, "#e2cde4") +
      box(0, 49, 64, 15, "#554968") +
      box(0, 49, 64, 2, "#bca0c5") +
      box(0, 57, 64, 1, "#807090") +
      box(9, 51, 1, 6, "#807090") +
      box(54, 51, 1, 6, "#807090") +
      box(30, 58, 1, 6, "#807090");
    case 4: return box(0, 0, 64, 64, background) +
      box(0, 49, 64, 15, "#30233f") +
      box(0, 49, 64, 2, "#bd729e") +
      box(1, 24, 10, 25, "#211b35") +
      box(2, 25, 8, 3, "#efbb68") +
      box(3, 30, 6, 8, "#639eae") +
      box(4, 32, 2, 2, "#a7f2dc") +
      box(2, 40, 8, 2, "#9f70b4") +
      box(4, 39, 2, 1, "#f4b6d4") +
      box(53, 21, 10, 28, "#211b35") +
      box(54, 22, 8, 3, "#a284ed") +
      box(55, 27, 6, 9, "#a56099") +
      box(56, 29, 3, 3, "#f4c678") +
      box(54, 39, 8, 2, "#639eae") +
      box(57, 38, 2, 1, "#a7f2dc") +
      box(8, 8, 48, 2, "#775393") +
      box(13, 12, 8, 2, "#ef93bf") +
      box(43, 12, 8, 2, "#8de0dc") +
      box(6, 56, 8, 1, "#644369") +
      box(50, 59, 8, 1, "#644369");
    default: return box(0, 0, 64, 64, background) +
      box(0, 43, 64, 21, "#416b55") +
      box(0, 44, 64, 4, "#719563") +
      box(0, 51, 64, 13, "#335444") +
      box(0, 53, 64, 1, "#557953") +
      box(3, 12, 12, 3, "#ccbdce") +
      box(6, 10, 6, 2, "#ccbdce") +
      box(47, 7, 14, 3, "#ccbdce") +
      box(51, 5, 6, 2, "#ccbdce") +
      box(2, 35, 5, 10, "#294b40") +
      box(0, 30, 9, 7, "#5a8456") +
      box(54, 32, 7, 13, "#294b40") +
      box(51, 27, 13, 8, "#5a8456") +
      box(8, 48, 1, 5, "#9bb96c") +
      box(6, 47, 5, 2, "#e7ba78") +
      box(8, 47, 1, 1, "#ffe3ae") +
      box(55, 49, 1, 5, "#9bb96c") +
      box(53, 48, 5, 2, "#db97b6") +
      box(6, 59, 3, 1, "#86a064") +
      box(48, 58, 4, 1, "#86a064");
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
  return `<g class="body">` +
    box(17, 18, 30, 24, ink) + box(19, 20, 26, 20, body) +
    box(16, 24, 3, 8, "#6bdce3") + box(45, 24, 3, 8, "#6bdce3") +
    box(22, 23, 20, 12, "#192a41") + eyes(expression, 26, 36, 27, "#79e3e3") +
    box(25, 36, 14, 2, ink) + box(30, 36, 4, 1, "#f0bd5e") +
    box(21, 41, 22, 4, ink) + box(23, 41, 18, 2, "#2b4767") +
    `<g class="arm-a">${box(12, 27, 5, 11, ink)}${box(13, 30, 3, 6, body)}${box(11, 38, 5, 3, "#f0bd5e")}</g>` +
    `<g class="arm-b">${box(47, 27, 5, 11, ink)}${box(48, 30, 3, 6, body)}${box(48, 38, 5, 3, "#f0bd5e")}</g>` +
    `</g>` + feet(1, ink, body);
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

function accessory(index) {
  if (index === 0) return box(31, 12, 2, 6, "#302048") +
    box(29, 10, 6, 3, "#f0bd5e") +
    box(31, 9, 2, 1, "#ffe078");
  if (index === 1) return box(23, 16, 18, 2, "#8c405f") +
    box(25, 13, 14, 3, "#f16d8c") +
    box(27, 10, 10, 3, "#f16d8c") +
    box(29, 7, 6, 3, "#f16d8c") +
    box(31, 5, 2, 2, "#ffe078") +
    box(27, 14, 3, 2, "#ffe078") +
    box(32, 10, 3, 2, "#ffe078") +
    box(34, 14, 3, 2, "#c5acff");
  if (index === 2) return box(22, 15, 20, 3, "#b47c32") +
    box(23, 9, 4, 6, "#f5cb67") +
    box(30, 7, 4, 8, "#f5cb67") +
    box(37, 9, 4, 6, "#f5cb67") +
    box(24, 15, 16, 2, "#ffe6a0") +
    box(26, 15, 2, 2, "#c58cf0") +
    box(31, 15, 2, 2, "#ed87a5") +
    box(36, 15, 2, 2, "#84dbd3");
  if (index === 3) return box(24, 9, 16, 2, "#b98d47") +
    box(22, 11, 4, 2, "#fbe9aa") +
    box(38, 11, 4, 2, "#fbe9aa") +
    box(25, 13, 14, 2, "#fbe9aa") +
    box(25, 8, 14, 1, "#fff5d0");
  if (index === 4) return box(31, 12, 2, 6, "#302048") +
    box(29, 10, 6, 3, "#f0bd5e") +
    box(31, 9, 2, 1, "#ffe078") +
    box(27, 41, 4, 3, "#ec6c7c") +
    box(33, 41, 4, 3, "#ec6c7c") +
    box(31, 42, 2, 2, "#f9d77d");
  if (index === 5) return box(31, 12, 2, 6, "#302048") +
    box(29, 10, 6, 3, "#f0bd5e") +
    box(31, 9, 2, 1, "#ffe078") +
    box(52, 33, 7, 7, "#327e9c") +
    box(53, 34, 5, 5, "#69dce3") +
    box(54, 34, 2, 2, "#ffffff") +
    box(54, 41, 3, 1, "#458793");
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
  const duration = ["1.1294s", "0.8471s", "1.8824s", "0.6588s"][traits.motion];
  const style = `<style>.body{animation:bob ${duration} steps(1) infinite}.foot-a{animation:step-a ${duration} steps(1) infinite}.foot-b{animation:step-b ${duration} steps(1) infinite}.arm-a{animation:arm-a ${duration} steps(1) infinite}.arm-b{animation:arm-b ${duration} steps(1) infinite}@keyframes bob{0%,50%,100%{transform:translateY(0)}12.5%,37.5%,62.5%,87.5%{transform:translateY(-1px)}25%,75%{transform:translateY(0)}}@keyframes step-a{0%,100%{transform:translate(-1px,0)}12.5%{transform:translate(0,-1px)}25%{transform:translate(1px,-2px)}37.5%{transform:translate(2px,-1px)}50%{transform:translate(2px,0)}62.5%{transform:translate(1px,0)}75%{transform:translate(0,0)}87.5%{transform:translate(-1px,0)}}@keyframes step-b{0%,100%{transform:translate(2px,0)}12.5%{transform:translate(1px,0)}25%{transform:translate(0,0)}37.5%{transform:translate(-1px,0)}50%{transform:translate(-1px,0)}62.5%{transform:translate(0,-1px)}75%{transform:translate(1px,-2px)}87.5%{transform:translate(2px,-1px)}}@keyframes arm-a{0%,100%{transform:translate(1px,0)}25%{transform:translate(-1px,1px)}50%{transform:translate(-1px,0)}75%{transform:translate(1px,-1px)}}@keyframes arm-b{0%,100%{transform:translate(-1px,0)}25%{transform:translate(1px,-1px)}50%{transform:translate(1px,0)}75%{transform:translate(-1px,1px)}}@media(prefers-reduced-motion:reduce){.body,.foot-a,.foot-b,.arm-a,.arm-b{animation:none}}</style>`;
  const evolution = stage ? box(4, 4, 2, 2, "#ffe078") + box(57, 9, 2, 2, "#ffe078") : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%" shape-rendering="crispEdges" data-species="${traits.species}">${style}${habitat(traits.habitat, background)}${eraMark(traits.era)}${box(17, 50, 32, 2, "#17212d")}${sprite}<g class="body">${accessory(traits.acc)}</g>${evolution}</svg>`;
}
