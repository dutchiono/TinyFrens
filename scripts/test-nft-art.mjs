import assert from "node:assert/strict";
import { test } from "node:test";
import { generateTraits, renderSVG, TOTAL_SUPPLY } from "./generate-permutations.mjs";

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
