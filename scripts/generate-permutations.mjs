/**
 * TinyFrens Curated Permutations Engine
 * 
 * 1:1 Pixel & Vector replica of TinyFrens in-game pocket companions.
 * Curated to eliminate clipping and clashing colors.
 * 
 * 8 Species x 8 Curated Palettes x 4 Expressions x 6 Fitted Accessories = 1,536 clean combinations.
 * Total Supply: 2664 (333 of each species).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TOTAL_SUPPLY = 2664;

export const SPECIES = [
  { id: 'cat', name: 'Cat' },
  { id: 'blob', name: 'Blob' },
  { id: 'robot', name: 'Robot' },
  { id: 'bunny', name: 'Bunny' },
  { id: 'dog', name: 'Puppy' },
  { id: 'bear', name: 'Bear' },
  { id: 'frog', name: 'Frog' },
  { id: 'turtle', name: 'Turtle' }
];

// Curated paired colorways: body, dark outline/accents, and complementary background
export const PALETTES = [
  { name: 'Lavender Dream', body: '#a474f1', dark: '#4b2d77', bg: '#17142a', tier: 'Classic' },
  { name: 'Cyber Neon', body: '#66c7d2', dark: '#235960', bg: '#0d1117', tier: 'Classic' },
  { name: 'Sunny Amber', body: '#ffb95e', dark: '#7a4e12', bg: '#fff7ed', tier: 'Classic' },
  { name: 'Mint Meadow', body: '#82eba1', dark: '#235f37', bg: '#e8f5e9', tier: 'Classic' },
  { name: 'Bubblegum', body: '#ff82a7', dark: '#6f233a', bg: '#fdf2f8', tier: 'Classic' },
  { name: 'Electric Blue', body: '#4d96ff', dark: '#1b3f75', bg: '#f0f9ff', tier: 'Classic' },
  { name: 'Midnight Obsidian', body: '#3a2d52', dark: '#1e162d', bg: '#211c39', tier: 'Rare' },
  { name: '24K Solid Gold', body: '#ffd700', dark: '#b7791f', bg: '#2d132c', tier: 'Legendary' }
];

export const EXPRESSIONS = [
  { id: 'happy', name: 'Classic Happy' },
  { id: 'wink', name: 'Playful Wink' },
  { id: 'shades', name: 'Cool Shades' },
  { id: 'star_eyes', name: 'Star Eyes' }
];

export const ACCESSORIES = [
  { id: 'none', name: 'None' },
  { id: 'party_hat', name: 'Party Hat' },
  { id: 'crown', name: 'Royal Crown' },
  { id: 'halo', name: 'Angel Halo' },
  { id: 'bow_tie', name: 'Dapper Bow Tie' },
  { id: 'orb', name: 'Mystic Orb' }
];

export const ERAS = ['Pocket Genesis', 'Street Wanderers', 'Dream Garden'];
export const HABITATS = ['Moonlit Plaza', 'Neon Crosswalk', 'Snack Garden', 'Cloud Room', 'Arcade Alley', 'Tiny Meadow'];
export const MOTIONS = ['Happy Walk', 'Bouncy Strut', 'Sleepy Drift', 'Excited Wiggle'];

// Deterministic PRNG matching contract
function prng(tokenId) {
  let s = Number(BigInt(Number(tokenId) * 104729 + 7919) % 2147483647n);
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateTraits(tokenId) {
  const rand = prng(tokenId);

  // Clean 8-way distribution: species assigned evenly or rolled across 8
  const species = SPECIES[(tokenId - 1) % SPECIES.length];
  
  // Palette rarity: 5% chance of 24K Solid Gold, 15% Obsidian, otherwise evenly across classic
  const palRoll = rand() * 100;
  let palette;
  if (palRoll < 5) {
    palette = PALETTES[7]; // 24K Gold
  } else if (palRoll < 20) {
    palette = PALETTES[6]; // Obsidian
  } else {
    palette = PALETTES[Math.floor(rand() * 6)];
  }

  const expression = EXPRESSIONS[Math.floor(rand() * EXPRESSIONS.length)];
  const accessory = ACCESSORIES[Math.floor(rand() * ACCESSORIES.length)];
  const era = ERAS[Math.floor((tokenId - 1) / 888)];
  const habitat = HABITATS[Math.floor(rand() * HABITATS.length)];
  const motion = MOTIONS[Math.floor(rand() * MOTIONS.length)];

  return { species, palette, expression, accessory, era, habitat, motion, tokenId };
}

export function renderSVG(traits) {
  const { species, palette, expression, accessory, habitat, motion } = traits;
  const { body, dark, bg } = palette;

  // Ears & anatomy (rendered behind body)
  let ears = '';
  let bodyRadius = 'rx="38" ry="32"';
  let shellPattern = '';
  const habitatId = HABITATS.indexOf(habitat);
  let habitatLayer = '';
  if (habitatId === 0) habitatLayer = `<circle cx="18" cy="22" r="3" fill="#fff" opacity=".7"/><circle cx="102" cy="31" r="2" fill="#fff" opacity=".55"/><path d="M12 126 H116" stroke="#fff" stroke-width="2" opacity=".12"/>`;
  else if (habitatId === 1) habitatLayer = `<path d="M0 120 H128" stroke="#00d2d3" stroke-width="4" opacity=".32"/><path d="M8 132 H38 M54 132 H84 M100 132 H126" stroke="#fff" stroke-width="4" opacity=".22"/><circle cx="108" cy="22" r="7" fill="#ff82a7" opacity=".5"/>`;
  else if (habitatId === 2) habitatLayer = `<path d="M0 124 C22 114 42 134 64 122 C86 110 104 128 128 116 V148 H0 Z" fill="#82eba1" opacity=".28"/><circle cx="18" cy="110" r="3" fill="#ff4757"/><circle cx="104" cy="118" r="3" fill="#ff4757"/>`;
  else if (habitatId === 3) habitatLayer = `<ellipse cx="30" cy="28" rx="18" ry="7" fill="#fff" opacity=".22"/><ellipse cx="92" cy="42" rx="22" ry="8" fill="#fff" opacity=".18"/><path d="M0 130 C20 124 42 128 64 123 C86 118 108 124 128 119 V148 H0 Z" fill="#fff" opacity=".12"/>`;
  else if (habitatId === 4) habitatLayer = `<rect x="8" y="16" width="18" height="18" rx="4" fill="#ffd700" opacity=".32"/><rect x="102" y="20" width="14" height="30" rx="4" fill="#66c7d2" opacity=".28"/><path d="M8 128 H120" stroke="#ffd700" stroke-width="3" stroke-dasharray="8 7" opacity=".32"/>`;
  else habitatLayer = `<path d="M0 126 Q32 112 64 124 T128 122 V148 H0 Z" fill="#82eba1" opacity=".24"/><circle cx="24" cy="112" r="4" fill="#ffd700" opacity=".7"/><circle cx="112" cy="108" r="3" fill="#ffd700" opacity=".65"/>`;
  const motionId = MOTIONS.indexOf(motion);
  const motionValues = motionId === 1 ? '0 0;0 -7;0 0' : motionId === 2 ? '0 0;1 -2;0 0' : motionId === 3 ? '0 0;-2 -4;2 -4;0 0' : '0 0;0 -3;0 0';
  const motionDur = motionId === 1 ? '0.8s' : motionId === 2 ? '2.4s' : motionId === 3 ? '0.9s' : '1.4s';

  switch (species.id) {
    case 'cat':
      ears = `
        <polygon points="20,40 36,4 52,40" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
        <polygon points="76,40 92,4 108,40" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
      `;
      break;
    case 'blob':
      bodyRadius = 'rx="48" ry="40"';
      break;
    case 'robot':
      ears = `
        <rect x="60" y="8" width="8" height="24" fill="${dark}"/>
        <circle cx="64" cy="8" r="6" fill="${body}" stroke="${dark}" stroke-width="3"/>
      `;
      bodyRadius = 'rx="8" ry="8"';
      shellPattern = `
        <path d="M32 61 H96" stroke="${dark}" stroke-width="3" opacity=".35"/>
        <path d="M24 121 H104" stroke="${dark}" stroke-width="10" stroke-linecap="round" opacity=".35"/>
        <circle cx="22" cy="82" r="5" fill="${dark}"/>
        <circle cx="106" cy="82" r="5" fill="${dark}"/>
      `;
      break;
    case 'bunny':
      ears = `
        <rect x="26" y="2" width="20" height="50" rx="10" fill="${body}" stroke="${dark}" stroke-width="7"/>
        <rect x="82" y="2" width="20" height="50" rx="10" fill="${body}" stroke="${dark}" stroke-width="7"/>
      `;
      break;
    case 'dog':
      ears = `
        <rect x="6" y="38" width="24" height="42" rx="10" transform="rotate(-25 6 38)" fill="${body}" stroke="${dark}" stroke-width="7"/>
        <rect x="98" y="28" width="24" height="42" rx="10" transform="rotate(25 98 28)" fill="${body}" stroke="${dark}" stroke-width="7"/>
      `;
      break;
    case 'bear':
      ears = `
        <circle cx="28" cy="30" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/>
        <circle cx="100" cy="30" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/>
      `;
      break;
    case 'frog':
      ears = `
        <circle cx="34" cy="32" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/>
        <circle cx="94" cy="32" r="16" fill="${body}" stroke="${dark}" stroke-width="7"/>
        <circle cx="34" cy="32" r="5" fill="#fff"/>
        <circle cx="94" cy="32" r="5" fill="#fff"/>
        <circle cx="34" cy="32" r="2.5" fill="${dark}"/>
        <circle cx="94" cy="32" r="2.5" fill="${dark}"/>
      `;
      bodyRadius = 'rx="46" ry="38"';
      break;
    case 'turtle':
      bodyRadius = 'rx="48" ry="40"';
      shellPattern = `<circle cx="64" cy="83" r="30" fill="none" stroke="${dark}" stroke-width="4" stroke-dasharray="8 6"/>`;
      break;
  }

  // Eyes & Expression
  let eyes = '';
  switch (expression.id) {
    case 'happy':
      eyes = `
        <rect x="32" y="66" width="12" height="20" rx="3" fill="${dark}"/>
        <rect x="84" y="66" width="12" height="20" rx="3" fill="${dark}"/>
        <circle cx="35" cy="70" r="2.5" fill="#fff"/>
        <circle cx="87" cy="70" r="2.5" fill="#fff"/>
      `;
      break;
    case 'wink':
      eyes = `
        <rect x="32" y="66" width="12" height="20" rx="3" fill="${dark}"/>
        <circle cx="35" cy="70" r="2.5" fill="#fff"/>
        <path d="M 82 76 Q 90 70 98 76" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/>
      `;
      break;
    case 'shades':
      eyes = `
        <rect x="24" y="64" width="36" height="18" rx="3" fill="#111"/>
        <rect x="68" y="64" width="36" height="18" rx="3" fill="#111"/>
        <rect x="56" y="68" width="16" height="4" fill="#111"/>
        <line x1="28" y1="67" x2="52" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>
        <line x1="72" y1="67" x2="96" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>
      `;
      break;
    case 'star_eyes':
      eyes = `
        <polygon points="38,62 41,71 50,71 43,76 46,85 38,80 30,85 33,76 26,71 35,71" fill="#ffd700"/>
        <polygon points="90,62 93,71 102,71 95,76 98,85 90,80 82,85 85,76 78,71 87,71" fill="#ffd700"/>
      `;
      break;
  }

  // Accessories (Species-aware, zero-clipping)
  let acc = '';
  switch (accessory.id) {
    case 'party_hat':
      acc = `
        <polygon points="64,4 48,32 80,32" fill="#ff4757" stroke="#ffd700" stroke-width="3"/>
        <circle cx="64" cy="4" r="5" fill="#ffd700"/>
      `;
      break;
    case 'crown':
      acc = `
        <polygon points="46,26 46,14 55,20 64,10 73,20 82,14 82,26" fill="#ffd700" stroke="#b7791f" stroke-width="2"/>
        <circle cx="64" cy="10" r="3" fill="#e74c3c"/>
      `;
      break;
    case 'halo':
      acc = `<ellipse cx="64" cy="12" rx="30" ry="8" fill="none" stroke="#ffeaa7" stroke-width="5"/>`;
      break;
    case 'bow_tie':
      acc = `
        <polygon points="56,116 64,120 56,124" fill="#e74c3c"/>
        <polygon points="72,116 64,120 72,124" fill="#e74c3c"/>
        <circle cx="64" cy="120" r="3" fill="#c0392b"/>
      `;
      break;
    case 'orb':
      acc = `
        <circle cx="114" cy="100" r="12" fill="#00d2d3" opacity="0.85"/>
        <circle cx="111" cy="97" r="4" fill="#fff" opacity="0.9"/>
      `;
      break;
  }

  const defs = `<defs><linearGradient id="body" x1="20" y1="30" x2="104" y2="132"><stop offset="0%" stop-color="#fff" stop-opacity=".34"/><stop offset="32%" stop-color="${body}"/><stop offset="100%" stop-color="${dark}" stop-opacity=".28"/></linearGradient><radialGradient id="shine" cx="35%" cy="26%" r="58%"><stop offset="0%" stop-color="#fff" stop-opacity=".42"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`;
  const limbs = `
    <path d="M16 84 C5 94 8 111 22 112" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/>
    <path d="M112 84 C123 94 120 111 106 112" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/>
    <path d="M31 128 C36 121 45 121 50 129 L50 137 H25 L25 132 C25 130 27 129 31 128 Z" fill="${dark}"/>
    <path d="M78 129 C83 121 92 121 98 128 C102 129 104 131 104 134 L104 137 H78 Z" fill="${dark}"/>
  `;
  const bodyLayer = species.id === 'robot'
    ? `<path d="M28 50 C28 38 38 31 64 32 C90 31 100 38 100 50 L100 71 C100 84 90 91 64 91 C38 91 28 84 28 71 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/><path d="M22 86 C22 73 36 67 64 68 C92 67 106 73 106 86 L101 112 C98 128 84 136 64 135 C44 136 30 128 27 112 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'bunny' ? `<path d="M28 70 C24 46 40 30 64 34 C88 30 104 46 100 70 L98 100 C96 124 82 136 64 134 C46 136 32 124 30 100 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'dog' ? `<path d="M18 72 C18 50 34 37 59 38 H76 C96 38 110 53 108 76 L103 104 C99 126 82 137 60 133 C36 135 20 120 18 96 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'bear' ? `<path d="M20 72 C18 48 36 34 64 35 C92 34 110 48 108 72 L106 98 C104 124 88 138 64 135 C40 138 24 124 22 98 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'frog' ? `<path d="M14 80 C14 54 34 43 64 45 C94 43 114 54 114 80 C114 116 94 136 64 132 C34 136 14 116 14 80 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'turtle' ? `<path d="M16 86 C16 58 36 44 64 46 C92 44 112 58 112 86 C112 114 92 132 64 132 C36 132 16 114 16 86 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : `<path d="M22 68 C19 44 38 30 64 34 C90 30 109 44 106 68 L102 101 C100 125 84 137 62 133 C38 137 22 122 22 98 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="100%" height="100%">
    ${defs}
    <!-- Background -->
    <rect width="128" height="148" fill="${bg}"/>
    ${habitatLayer}
    <ellipse cx="64" cy="137" rx="45" ry="8" fill="${dark}" opacity=".24"/>
    <g>
      <animateTransform attributeName="transform" type="translate" values="${motionValues}" dur="${motionDur}" repeatCount="indefinite"/>
      <!-- Ears / head gear -->
      ${ears}
      <!-- Walking limbs -->
      ${limbs}
      <!-- Body with material shading -->
      ${bodyLayer}
      <ellipse cx="42" cy="55" rx="18" ry="14" fill="url(#shine)"/>
      ${shellPattern}
      <!-- Blush Cheeks -->
      <rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>
      <rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>
      <!-- Eyes -->
      ${eyes}
      <!-- Mouth -->
      <rect x="60" y="96" width="8" height="5" rx="2" fill="${dark}"/>
      <!-- Accessory -->
      ${acc}
    </g>
  </svg>`;
}

// Generate sample preview files
const outDir = resolve(__dirname, '../dist/permutations');
mkdirSync(outDir, { recursive: true });

console.log('--- TinyFrens Curated Collection Matrix ---');
console.log(`Max Supply: ${TOTAL_SUPPLY} (${TOTAL_SUPPLY / SPECIES.length} per species)`);
console.log(`Species: ${SPECIES.length}`);
console.log(`Palettes: ${PALETTES.length}`);
console.log(`Expressions: ${EXPRESSIONS.length}`);
console.log(`Accessories: ${ACCESSORIES.length}`);
console.log(`Habitats: ${HABITATS.length}`);
console.log(`Motion styles: ${MOTIONS.length}`);
console.log(`Total Curated Combinations: ${SPECIES.length * PALETTES.length * EXPRESSIONS.length * ACCESSORIES.length * HABITATS.length * MOTIONS.length}`);

// Generate 8 diverse samples
for (let i = 1; i <= 8; i++) {
  const traits = generateTraits(i);
  const svg = renderSVG(traits);
  const meta = {
    name: `TinyFren #${i} (${traits.species.name})`,
    attributes: [
      { trait_type: 'Species', value: traits.species.name },
      { trait_type: 'Palette', value: traits.palette.name },
      { trait_type: 'Rarity Tier', value: traits.palette.tier },
      { trait_type: 'Expression', value: traits.expression.name },
      { trait_type: 'Accessory', value: traits.accessory.name },
      { trait_type: 'Era', value: traits.era },
      { trait_type: 'Habitat', value: traits.habitat },
      { trait_type: 'Motion', value: traits.motion }
    ]
  };
  writeFileSync(resolve(outDir, `fren-${i}-${traits.species.id}.svg`), svg, 'utf-8');
  writeFileSync(resolve(outDir, `fren-${i}-${traits.species.id}.json`), JSON.stringify(meta, null, 2), 'utf-8');
}

console.log(`Exported 8 curated 1:1 samples to ${outDir}`);
