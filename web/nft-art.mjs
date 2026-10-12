import { motionStyle } from "./robot-motion.mjs";
import { renderScene, renderTiles } from "./robot-scenes.mjs";

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
    `<g class="sheen">` + box(20, 20, 23, 1, "#d5e5eb") + box(19, 21, 1, 16, "#b9c6e4") + `</g>` +
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

const ACCESSORY_TILES = [[[46,18,3,9,"#302048"],[43,15,9,4,"#f0bd5e"],[46,13,3,2,"#ffe078"]],[[30,24,36,3,"#24344f"],[33,18,30,6,"#6e8da9"],[37,15,21,3,"#a9c7d6"],[34,18,5,4,"#d1e3e8"],[39,19,19,3,"#4bd2dc"],[40,19,8,2,"#c1f6ef"],[46,15,3,3,"#f1d18a"],[58,22,5,2,"#324f6c"]],[[33,24,30,3,"#795038"],[34,18,27,6,"#c18b3c"],[33,15,4,9,"#e6b54f"],[58,15,5,9,"#e6b54f"],[45,13,6,11,"#e6b54f"],[37,21,8,3,"#e6b54f"],[51,21,7,3,"#e6b54f"],[34,24,27,1,"#ffe3a0"],[34,16,2,6,"#ffe3a0"],[45,15,1,4,"#ffe3a0"],[40,22,3,2,"#75d0d7"],[52,22,3,2,"#e38eac"],[46,21,3,3,"#9555a1"]],[[37,15,21,1,"#bd8742"],[33,16,4,2,"#bd8742"],[58,16,5,2,"#bd8742"],[31,18,5,4,"#bd8742"],[60,18,4,4,"#bd8742"],[34,22,27,2,"#bd8742"],[37,24,21,1,"#bd8742"],[37,16,21,2,"#fff1bd"],[33,18,3,3,"#fff1bd"],[60,18,3,3,"#f1c86c"],[36,21,24,3,"#f1c86c"],[39,21,18,1,"#fff4d4"]],[[46,18,3,9,"#302048"],[43,15,9,4,"#f0bd5e"],[46,13,3,2,"#ffe078"],[36,60,24,1,"#e1d7cf"],[36,61,6,6,"#84324f"],[54,61,6,6,"#84324f"],[37,61,5,5,"#ef7996"],[42,63,4,3,"#cf526f"],[49,63,5,3,"#cf526f"],[54,61,4,5,"#ef7996"],[37,61,3,2,"#ffb0b8"],[55,61,3,2,"#ffb0b8"],[46,63,3,3,"#e9c371"]],[[46,18,3,9,"#302048"],[43,15,9,4,"#f0bd5e"],[46,13,3,2,"#ffe078"],[82,33,6,1,"#244762"],[79,34,12,3,"#244762"],[78,37,15,6,"#244762"],[79,43,12,3,"#244762"],[82,46,6,2,"#244762"],[82,34,6,2,"#9aede4"],[81,36,9,7,"#50b5ca"],[82,43,6,2,"#387b9e"],[81,37,3,5,"#9aede4"],[84,36,4,4,"#74d9dc"],[87,40,3,3,"#3785aa"],[82,36,3,1,"#ecfff2"]]];
function accessory(index) {
  const tiles = ACCESSORY_TILES[index];
  if (index === 3) return '<g class="halo">' + renderTiles(tiles) + '</g>';
  if (index === 5) return renderTiles(tiles.slice(0, 3)) + '<g class="orb">' + renderTiles(tiles.slice(3)) + '</g>';
  return renderTiles(tiles);
}

function eraMark(era) {
  if (era === 0) return box(23, 39, 2, 1, "#dc9979");
  if (era === 1) return box(23, 39, 2, 1, "#b9c5dc") + box(27, 39, 2, 1, "#b9c5dc");
  return box(23, 39, 2, 1, "#ffe078") + box(27, 39, 2, 1, "#ffe078") +
    box(31, 39, 2, 1, "#ffe078");
}

export function renderNftArt(traits, stage = 0) {
  const [body, ink, background] = NFT_PALETTES[traits.palette];
  const sprite = robot(body, ink, traits.expr);
  const duration = ["1.1294s", "0.8471s", "1.8824s", "0.6588s"][traits.motion];
  const phase = ["-0.5647s", "-0.42355s", "-0.9412s", "-0.3294s"][traits.motion];
  const style = `<style>${motionStyle(traits.ambience)}.body{animation:bob ${duration} steps(1) infinite}.foot-a{animation:step-a ${duration} steps(1) infinite}.foot-b{animation:step-a ${duration} steps(1) infinite;animation-delay:${phase}}.arm-a{animation:arm-a ${duration} steps(1) infinite}.arm-b{animation:arm-a ${duration} steps(1) infinite;animation-delay:${phase}}@keyframes bob{0%,50%,100%{transform:translateY(0)}12.5%,37.5%,62.5%,87.5%{transform:translateY(-1px)}25%,75%{transform:translateY(0)}}@keyframes step-a{0%,100%{transform:translate(-1px,0)}12.5%{transform:translate(0,-1px)}25%{transform:translate(1px,-2px)}37.5%{transform:translate(2px,-1px)}50%{transform:translate(2px,0)}62.5%{transform:translate(1px,0)}75%{transform:translate(0,0)}87.5%{transform:translate(-1px,0)}}@keyframes arm-a{0%,100%{transform:translate(1px,0)}25%{transform:translate(-1px,1px)}50%{transform:translate(-1px,0)}75%{transform:translate(1px,-1px)}}.orb,.halo{animation:hover var(--float) steps(4) infinite alternate}@keyframes hover{from{transform:translateY(0)}to{transform:translateY(-2px)}}.parallax{animation:parallax var(--depth) steps(4) infinite alternate}.light{animation:lighting var(--light) steps(4) infinite alternate}.sheen{animation:shade var(--light) steps(4) infinite alternate}.drift{animation:breeze var(--cloud) steps(10) infinite alternate}.twinkle{animation:sparkle var(--stars) steps(8) infinite alternate}.glow{animation:glimmer var(--glow) steps(4) infinite alternate}.sway{animation:sway var(--sway) steps(4) infinite alternate}.leaf{animation:fall var(--leaves) steps(14) infinite}.shadow{animation:shade var(--light) steps(6) infinite alternate}.late{animation-delay:-7s}@keyframes parallax{from{transform:translateX(-1px)}to{transform:translateX(1px)}}@keyframes lighting{from{opacity:.02}to{opacity:.18}}@keyframes breeze{from{transform:translateX(-5px)}to{transform:translateX(5px)}}@keyframes sparkle{0%,15%{opacity:0}70%,100%{opacity:1}}@keyframes glimmer{from{opacity:.35}to{opacity:1}}@keyframes sway{from{transform:translateX(-1px)}to{transform:translateX(1px)}}@keyframes fall{0%{transform:translate(-3px,-3px);opacity:0}10%{opacity:1}80%{opacity:1}100%{transform:translate(4px,18px);opacity:0}}@keyframes shade{from{opacity:.65}to{opacity:1}}@media(prefers-reduced-motion:reduce){.body,.foot-a,.foot-b,.arm-a,.arm-b,.drift,.twinkle,.glow,.sway,.leaf,.shadow,.parallax,.light,.sheen,.orb,.halo{animation:none}}</style>`;
  const evolution = stage ? box(4, 4, 2, 2, "#ffe078") + box(57, 9, 2, 2, "#ffe078") : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="100%" height="100%" shape-rendering="crispEdges" data-species="${traits.species}">${style}${renderScene(traits.habitat, background)}<g transform="translate(16 30)"><g class="shadow">${box(17, 50, 32, 2, "#17212d")}</g>${sprite}<g class="body">${accessory(traits.acc)}${eraMark(traits.era)}</g></g>${evolution}</svg>`;
}
