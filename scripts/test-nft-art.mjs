import assert from "node:assert/strict";
import { test } from "node:test";
import { generateTraits, renderSVG, TOTAL_SUPPLY } from "./generate-permutations.mjs";
import { renderNftArt } from "../web/nft-art.mjs";
import { ROBOT_SCENES } from "../web/robot-scenes.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { ROBOT_COLLECTION } from "../web/robot-collection.mjs";

test("launch collection identity matches the browser and export identity", () => {
  const source = readFileSync(new URL("../contracts/TinyFrensNFT.sol", import.meta.url), "utf8");
  for (const [field, key] of [["COLLECTION_ID", "id"], ["COLLECTION_NAME", "name"], ["COLLECTION_SYMBOL", "symbol"], ["TOKEN_NAME_PREFIX", "tokenPrefix"], ["COLLECTION_DESCRIPTION", "description"]]) {
    const value = source.match(new RegExp(`string public constant ${field} = "([^"]+)";`));
    assert.equal(value?.[1], ROBOT_COLLECTION[key], field);
  }
  assert.equal(Number(source.match(/COLLECTION_VERSION = (\d+);/)?.[1]), ROBOT_COLLECTION.version);
});

test("packed contract scenes match the browser source", () => {
  execFileSync(process.execPath, [fileURLToPath(new URL("./sync-robot-scenes.mjs", import.meta.url)), "--check"], { stdio: "pipe" });
});

test("scene tiles fit the pixel canvas", () => {
  for (const layers of ROBOT_SCENES) for (const { tiles } of layers) {
    for (const [x, y, w, h, color] of tiles) {
      assert.ok([x, y, w, h].every(Number.isInteger));
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 64 && y + h <= 64);
      assert.ok(color === null || /^#[0-9a-f]{6}$/.test(color));
    }
  }
});

test("all 4608 trait combinations stay within the 7 KB SVG budget", () => {
  for (let palette = 0; palette < 8; palette++) for (let expr = 0; expr < 4; expr++)
    for (let acc = 0; acc < 6; acc++) for (let habitat = 0; habitat < 6; habitat++)
      for (let motion = 0; motion < 4; motion++) {
        const svg = renderNftArt({ species: 0, palette, expr, acc, era: 2, habitat, motion }, 2);
        assert.ok(Buffer.byteLength(svg) <= 7000, `Art exceeded budget: ${palette}/${expr}/${acc}/${habitat}/${motion}`);
        assert.match(svg, /\.leaf,\.shadow\{animation:none\}/);
      }
});

test("every token has unique visible art across the full collection", () => {
  const artwork = new Set();
  for (let tokenId = 1; tokenId <= TOTAL_SUPPLY; tokenId++) {
    const traits = generateTraits(tokenId);
    assert.equal(traits.species, 0);
    const svg = renderSVG(traits);
    assert.match(svg, /shape-rendering="crispEdges"/);
    assert.match(svg, /class="foot-a"/);
    assert.match(svg, /class="foot-b"/);
    assert.match(svg, /class="arm-a"/);
    assert.match(svg, /class="arm-b"/);
    assert.match(svg, /data-species="0"/);
    assert.ok(!artwork.has(svg), `Duplicate artwork at token #${tokenId}`);
    artwork.add(svg);
  }
  assert.equal(artwork.size, TOTAL_SUPPLY);
});
