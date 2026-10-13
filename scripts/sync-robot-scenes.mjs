import fs from "node:fs";
import { ROBOT_SCENES } from "../web/robot-scenes.mjs";

// Keep compact contract scene data identical to the editable browser artwork.
const path = new URL("../contracts/TinyFrensArt.sol", import.meta.url);
const hexByte = value => value.toString(16).padStart(2, "0");
function layer({ motion, tiles }) {
  const data = tiles.map(([x, y, w, h, color]) => [x, y, w, h].map(hexByte).join("") + (color?.slice(1) || "000000")).join("");
  const draw = `_scene(hex"${data}", bg)`;
  return motion ? `string.concat('<g class="${motion}">', ${draw}, '</g>')` : draw;
}
const generated = `    // Generated from web/robot-scenes.mjs by scripts/sync-robot-scenes.mjs.
    function _habitat(uint8 habitat, string memory bg) internal pure returns (string memory) {
${ROBOT_SCENES.map((layers, i) => `        ${i === 5 ? "return" : `if (habitat == ${i}) return`} string.concat(\n            ${layers.map(layer).join(",\n            ")}\n        );`).join("\n")}
    }

`;
const source = fs.readFileSync(path, "utf8");
const updated = source.replace(/    (?:\/\/ Generated[^\n]*\n    )?function _habitat\([\s\S]*?(?=    function _accessory)/, generated);
if (updated === source && !source.includes(generated)) throw new Error("Habitat function not found");
if (process.argv.includes("--check")) {
  if (updated !== source) throw new Error("Scene data is stale: run node scripts/sync-robot-scenes.mjs");
  console.log("Robot scene data matches Solidity");
} else fs.writeFileSync(path, updated);
