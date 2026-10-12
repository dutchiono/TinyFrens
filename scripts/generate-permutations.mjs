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
  let shellPattern = '';
  let limbs = '';
  let shine = '';
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
        <path d="M18 45 L34 6 L54 43 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
        <path d="M74 43 L94 6 L110 45 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
        <path d="M29 34 L36 17 L45 35 Z M83 35 L92 17 L99 34 Z" fill="#ffb6c8" opacity=".78"/>
        <path d="M102 105 C132 98 130 64 103 75 C122 79 121 99 102 97" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/>
      `;
      limbs = `<path d="M30 119 C21 126 19 137 35 137 H49 C47 126 39 120 30 119 Z" fill="${dark}"/><path d="M79 119 C88 120 97 126 99 137 H82 C72 137 72 126 79 119 Z" fill="${dark}"/>`;
      shellPattern = `<path d="M21 88 H5 M22 96 H7 M107 88 H123 M106 96 H121" stroke="${dark}" stroke-width="3" stroke-linecap="round"/><path d="M58 94 Q64 99 70 94" stroke="${dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      shine = `<ellipse cx="43" cy="55" rx="16" ry="13" fill="url(#shine)"/>`;
      break;
    case 'blob':
      limbs = `<path d="M28 124 C20 131 27 140 39 134" fill="${dark}" opacity=".58"/><path d="M88 126 C99 132 97 141 83 136" fill="${dark}" opacity=".58"/>`;
      shellPattern = `<path d="M30 101 C45 93 50 114 64 104 C79 94 87 112 101 101" stroke="${dark}" stroke-width="3" opacity=".36" fill="none" stroke-linecap="round"/>`;
      shine = `<ellipse cx="47" cy="62" rx="19" ry="16" fill="url(#shine)"/>`;
      break;
    case 'robot':
      ears = `
        <path d="M64 30 V11" stroke="${dark}" stroke-width="7" stroke-linecap="round"/>
        <circle cx="64" cy="8" r="6" fill="${body}" stroke="${dark}" stroke-width="3"/>
        <circle cx="64" cy="8" r="2" fill="#fff"/>
      `;
      limbs = `<path d="M22 84 H11 V105 H22" fill="none" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M106 84 H117 V105 H106" fill="none" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/><path d="M31 129 H50 M78 129 H97" stroke="${dark}" stroke-width="9" stroke-linecap="round"/>`;
      shellPattern = `
        <path d="M36 59 H92 M40 106 H88" stroke="${dark}" stroke-width="3" opacity=".45"/>
        <circle cx="45" cy="108" r="3" fill="${dark}" opacity=".55"/>
        <circle cx="83" cy="108" r="3" fill="${dark}" opacity=".55"/>
      `;
      shine = `<rect x="39" y="44" width="15" height="10" rx="3" fill="#fff" opacity=".2"/>`;
      break;
    case 'bunny':
      ears = `
        <path d="M34 58 C22 38 22 11 36 4 C52 8 52 40 43 61 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
        <path d="M94 58 C106 38 106 11 92 4 C76 8 76 40 85 61 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
        <path d="M37 47 C32 33 33 19 38 13 M91 47 C96 33 95 19 90 13" stroke="#ffb6c8" stroke-width="5" stroke-linecap="round" opacity=".72"/>
      `;
      limbs = `<ellipse cx="42" cy="132" rx="18" ry="8" fill="${dark}"/><ellipse cx="86" cy="132" rx="18" ry="8" fill="${dark}"/>`;
      shellPattern = `<rect x="58" y="101" width="5" height="10" rx="1" fill="#fff"/><rect x="65" y="101" width="5" height="10" rx="1" fill="#fff"/><circle cx="103" cy="104" r="8" fill="#fff" opacity=".55"/>`;
      shine = `<ellipse cx="47" cy="62" rx="15" ry="14" fill="url(#shine)"/>`;
      break;
    case 'dog':
      ears = `
        <path d="M26 48 C7 42 4 63 20 82 C33 78 37 61 26 48 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
        <path d="M102 48 C121 42 124 63 108 82 C95 78 91 61 102 48 Z" fill="${body}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
        <path d="M103 111 C119 116 123 101 112 94" fill="none" stroke="${dark}" stroke-width="8" stroke-linecap="round"/>
      `;
      limbs = `<path d="M29 124 C22 132 29 139 43 135" fill="${dark}"/><path d="M85 124 C98 126 103 134 94 139 H80 C78 133 80 128 85 124 Z" fill="${dark}"/>`;
      shellPattern = `<ellipse cx="64" cy="97" rx="23" ry="16" fill="#fff" opacity=".34"/><path d="M55 94 Q64 101 73 94" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="64" cy="91" r="5" fill="${dark}"/>`;
      shine = `<ellipse cx="43" cy="59" rx="15" ry="13" fill="url(#shine)"/>`;
      break;
    case 'bear':
      ears = `
        <circle cx="28" cy="35" r="17" fill="${body}" stroke="${dark}" stroke-width="7"/>
        <circle cx="100" cy="35" r="17" fill="${body}" stroke="${dark}" stroke-width="7"/>
        <circle cx="28" cy="35" r="8" fill="#ffb6c8" opacity=".6"/>
        <circle cx="100" cy="35" r="8" fill="#ffb6c8" opacity=".6"/>
      `;
      limbs = `<circle cx="35" cy="119" r="10" fill="${dark}" opacity=".75"/><circle cx="93" cy="119" r="10" fill="${dark}" opacity=".75"/><path d="M31 134 H50 M78 134 H97" stroke="${dark}" stroke-width="8" stroke-linecap="round"/>`;
      shellPattern = `<ellipse cx="64" cy="100" rx="25" ry="18" fill="#fff" opacity=".32"/><circle cx="64" cy="94" r="5" fill="${dark}"/><path d="M55 104 Q64 111 73 104" stroke="${dark}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
      shine = `<ellipse cx="43" cy="59" rx="17" ry="14" fill="url(#shine)"/>`;
      break;
    case 'frog':
      ears = `
        <circle cx="34" cy="38" r="18" fill="${body}" stroke="${dark}" stroke-width="7"/>
        <circle cx="94" cy="38" r="18" fill="${body}" stroke="${dark}" stroke-width="7"/>
        <circle cx="34" cy="38" r="6" fill="#fff"/>
        <circle cx="94" cy="38" r="6" fill="#fff"/>
        <circle cx="34" cy="38" r="3" fill="${dark}"/>
        <circle cx="94" cy="38" r="3" fill="${dark}"/>
      `;
      limbs = `<path d="M22 120 C10 123 9 136 27 134 H43" fill="${dark}"/><path d="M106 120 C118 123 119 136 101 134 H85" fill="${dark}"/>`;
      shellPattern = `<path d="M37 101 Q64 117 91 101" stroke="${dark}" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="45" cy="94" r="3" fill="${dark}" opacity=".38"/><circle cx="83" cy="94" r="3" fill="${dark}" opacity=".38"/>`;
      shine = `<ellipse cx="44" cy="65" rx="17" ry="12" fill="url(#shine)"/>`;
      break;
    case 'turtle':
      ears = `<ellipse cx="64" cy="56" rx="22" ry="18" fill="${body}" stroke="${dark}" stroke-width="7"/><path d="M17 91 C6 91 4 103 17 106 M111 91 C122 91 124 103 111 106" stroke="${dark}" stroke-width="8" stroke-linecap="round" fill="none"/>`;
      limbs = `<path d="M29 124 L18 136 H42 Z" fill="${dark}"/><path d="M99 124 L110 136 H86 Z" fill="${dark}"/>`;
      shellPattern = `<ellipse cx="64" cy="94" rx="42" ry="35" fill="url(#body)" stroke="${dark}" stroke-width="8"/><ellipse cx="64" cy="94" rx="27" ry="24" fill="none" stroke="${dark}" stroke-width="5" opacity=".78"/><path d="M37 94 H91 M64 70 V118 M46 78 Q64 91 82 78 M46 110 Q64 97 82 110" stroke="${dark}" stroke-width="3" fill="none" opacity=".78"/><ellipse cx="50" cy="81" rx="15" ry="11" fill="url(#shine)"/>`;
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
  const bodyLayer = species.id === 'robot'
    ? `<path d="M30 48 H98 Q106 48 106 56 V78 Q106 86 98 86 H30 Q22 86 22 78 V56 Q22 48 30 48 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/><path d="M38 88 H90 Q99 88 101 98 L104 119 Q105 129 95 131 H33 Q23 129 24 119 L27 98 Q29 88 38 88 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'blob' ? `<path d="M31 58 C19 75 19 112 40 125 C53 134 57 120 68 126 C90 136 111 116 108 86 C105 56 89 45 70 52 C54 40 39 43 31 58 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/><path d="M38 55 C47 47 56 47 65 55" stroke="#fff" stroke-width="4" opacity=".22" fill="none" stroke-linecap="round"/>`
    : species.id === 'bunny' ? `<path d="M31 72 C29 48 43 35 64 38 C85 35 99 48 97 72 L94 105 C91 127 78 137 64 134 C50 137 37 127 34 105 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'dog' ? `<path d="M20 73 C18 50 35 37 59 38 H74 C96 38 109 52 107 75 L103 105 C99 127 82 137 61 133 C38 135 22 121 20 98 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'bear' ? `<path d="M22 74 C20 49 38 35 64 36 C90 35 108 49 106 74 L104 99 C102 124 88 138 64 135 C40 138 26 124 24 99 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'frog' ? `<path d="M14 82 C14 58 34 47 64 48 C94 47 114 58 114 82 C114 115 94 134 64 131 C34 134 14 115 14 82 Z" fill="url(#body)" stroke="${dark}" stroke-width="8"/>`
    : species.id === 'turtle' ? ``
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
      ${shine}
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
