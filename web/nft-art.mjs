import { renderScene } from "./robot-scenes.mjs";

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

// Rebuild character tiles on integer native pixels; background tiles already use 128px coordinates.
const box = (x, y, width, height, color) => {
  const left = Math.floor(x * 3 / 2), top = Math.floor(y * 3 / 2);
  const w = Math.floor((x + width) * 3 / 2) - left;
  const h = Math.floor((y + height) * 3 / 2) - top;
  return `<path fill="${color}" d="M${left} ${top}h${w}v${h}H${left}z"/>`;
};


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
    box(20, 20, 23, 1, "#d5e5eb") + box(19, 21, 1, 16, "#b9c6e4") +
    box(43, 22, 2, 18, ink) + box(21, 21, 1, 1, ink) + box(42, 21, 1, 1, ink) +
    box(16, 24, 3, 8, "#6bdce3") + box(45, 24, 3, 8, "#6bdce3") +
    box(22, 23, 20, 12, "#192a41") + eyes(expression, 26, 36, 27, "#79e3e3") +
    box(23, 33, 3, 1, "#80c9ab") + box(28, 33, 2, 1, "#f0bd5e") +
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
  if (index === 1) return box(20, 16, 24, 2, "#24344f") +
    box(22, 12, 20, 4, "#6e8da9") +
    box(25, 10, 14, 2, "#a9c7d6") +
    box(23, 12, 3, 3, "#d1e3e8") +
    box(26, 13, 13, 2, "#4bd2dc") +
    box(27, 13, 5, 1, "#c1f6ef") +
    box(31, 10, 2, 2, "#f1d18a") +
    box(39, 15, 3, 1, "#324f6c");
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
  const phase = ["-0.5647s", "-0.42355s", "-0.9412s", "-0.3294s"][traits.motion];
  const style = `<style>.body{animation:bob ${duration} steps(1) infinite}.foot-a{animation:step-a ${duration} steps(1) infinite}.foot-b{animation:step-a ${duration} steps(1) infinite;animation-delay:${phase}}.arm-a{animation:arm-a ${duration} steps(1) infinite}.arm-b{animation:arm-a ${duration} steps(1) infinite;animation-delay:${phase}}@keyframes bob{0%,50%,100%{transform:translateY(0)}12.5%,37.5%,62.5%,87.5%{transform:translateY(-1px)}25%,75%{transform:translateY(0)}}@keyframes step-a{0%,100%{transform:translate(-1px,0)}12.5%{transform:translate(0,-1px)}25%{transform:translate(1px,-2px)}37.5%{transform:translate(2px,-1px)}50%{transform:translate(2px,0)}62.5%{transform:translate(1px,0)}75%{transform:translate(0,0)}87.5%{transform:translate(-1px,0)}}@keyframes arm-a{0%,100%{transform:translate(1px,0)}25%{transform:translate(-1px,1px)}50%{transform:translate(-1px,0)}75%{transform:translate(1px,-1px)}}.drift{animation:breeze 18s steps(12) infinite alternate}.twinkle{animation:sparkle 4s steps(3) infinite alternate}.glow{animation:glimmer 5s steps(4) infinite alternate}.sway{animation:sway 7s steps(4) infinite alternate}.leaf{animation:fall 14s steps(14) infinite}.shadow{animation:shade 6s steps(6) infinite alternate}.late{animation-delay:-7s}@keyframes breeze{from{transform:translateX(-2px)}to{transform:translateX(2px)}}@keyframes sparkle{from{opacity:.3}to{opacity:1}}@keyframes glimmer{from{opacity:.35}to{opacity:1}}@keyframes sway{from{transform:translateX(-1px)}to{transform:translateX(1px)}}@keyframes fall{0%{transform:translate(-3px,-3px);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translate(4px,18px);opacity:0}}@keyframes shade{from{opacity:.65}to{opacity:1}}@media(prefers-reduced-motion:reduce){.body,.foot-a,.foot-b,.arm-a,.arm-b,.drift,.twinkle,.glow,.sway,.leaf,.shadow{animation:none}}</style>`;
  const evolution = stage ? box(4, 4, 2, 2, "#ffe078") + box(57, 9, 2, 2, "#ffe078") : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%" shape-rendering="crispEdges" data-species="${traits.species}">${style}${renderScene(traits.habitat, background)}${eraMark(traits.era)}<g transform="translate(16 30)"><g class="shadow">${box(17, 50, 32, 2, "#17212d")}</g>${sprite}<g class="body">${accessory(traits.acc)}</g></g>${evolution}</svg>`;
}
