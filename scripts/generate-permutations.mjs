import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NFT_PALETTES, NFT_SPECIES, renderNftArt } from "../web/nft-art.mjs";
import { ROBOT_COLLECTION, robotTokenName } from "../web/robot-collection.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const TOTAL_SUPPLY = 2664;
export const SPECIES = NFT_SPECIES.map((name) => ({ id: name.toLowerCase(), name }));
export const PALETTES = NFT_PALETTES.map(([body, dark, bg, name, tier]) => ({ body, dark, bg, name, tier }));
export const EXPRESSIONS = ["Classic Happy", "Playful Wink", "Cool Shades", "Star Eyes"];
export const ACCESSORIES = ["None", "Pilot Helmet", "Royal Crown", "Angel Halo", "Dapper Bow Tie", "Mystic Orb"];
export const ERAS = ["Pocket Genesis", "Street Wanderers", "Dream Garden"];
export const HABITATS = ["Moonlit Plaza", "Neon Crosswalk", "Snack Garden", "Cloud Terrace", "Arcade Alley", "Tiny Meadow"];
export const MOTIONS = ["Happy Walk", "Bouncy Strut", "Sleepy Drift", "Excited Wiggle"];

export function generateTraits(tokenId) {
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > TOTAL_SUPPLY) {
    throw new RangeError("Token ID must be between 1 and 2664");
  }
  const artIndex = ((tokenId - 1) % 888 * 197 + 17) % 4608;
  const combination = Math.floor(artIndex / PALETTES.length);
  return {
    species: 0,
    palette: artIndex % PALETTES.length,
    expr: combination % EXPRESSIONS.length,
    acc: Math.floor(combination / 4) % ACCESSORIES.length,
    era: Math.floor((tokenId - 1) / 888),
    habitat: Math.floor(combination / 24) % HABITATS.length,
    motion: Math.floor(combination / 144) % MOTIONS.length,
  };
}

export const renderSVG = renderNftArt;

function exportSamples() {
  const outputDir = resolve(scriptDir, "../dist/permutations");
  mkdirSync(outputDir, { recursive: true });
  for (let tokenId = 1; tokenId <= 12; tokenId++) {
    const traits = generateTraits(tokenId);
    const species = SPECIES[traits.species];
    const metadata = {
      name: robotTokenName(tokenId),
      description: ROBOT_COLLECTION.description,
      attributes: [
        { trait_type: "Series", value: ROBOT_COLLECTION.series },
        { trait_type: "Edition", value: `v${ROBOT_COLLECTION.version}` },
        { trait_type: "Species", value: species.name },
        { trait_type: "Palette", value: PALETTES[traits.palette].name },
        { trait_type: "Rarity Tier", value: PALETTES[traits.palette].tier },
        { trait_type: "Expression", value: EXPRESSIONS[traits.expr] },
        { trait_type: "Accessory", value: ACCESSORIES[traits.acc] },
        { trait_type: "Era", value: ERAS[traits.era] },
        { trait_type: "Habitat", value: HABITATS[traits.habitat] },
        { trait_type: "Motion", value: MOTIONS[traits.motion] },
      ],
    };
    const basename = `fren-${tokenId}-${species.id}`;
    writeFileSync(resolve(outputDir, `${basename}.svg`), renderSVG(traits));
    writeFileSync(resolve(outputDir, `${basename}.json`), JSON.stringify(metadata, null, 2));
  }
  console.log(`Exported 12 robot-only pixel samples to ${outputDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) exportSamples();
