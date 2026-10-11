/**
 * TinyFrens Generative Permutation Engine
 * 
 * Generates deterministic traits, SVGs, and metadata for TinyFrens NFT collection.
 * Total permutations: 8 Shapes x 10 Colors x 10 Backgrounds x 8 Expressions x 10 Accessories = 64,000 unique combinations.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SHAPES = [
  { id: 'cat', name: 'Cat' },
  { id: 'blob', name: 'Blob' },
  { id: 'robot', name: 'Robot' },
  { id: 'bunny', name: 'Bunny' },
  { id: 'dog', name: 'Puppy' },
  { id: 'bear', name: 'Bear' },
  { id: 'frog', name: 'Frog' },
  { id: 'turtle', name: 'Turtle' }
];

export const COLORS = [
  { name: 'Lavender', hex: '#a474f1', outline: '#4b2d77' },
  { name: 'Cyber Cyan', hex: '#66c7d2', outline: '#235960' },
  { name: 'Sunny Amber', hex: '#ffb95e', outline: '#7a4e12' },
  { name: 'Mint Glow', hex: '#82eba1', outline: '#235f37' },
  { name: 'Bubblegum Pink', hex: '#ff82a7', outline: '#6f233a' },
  { name: 'Electric Blue', hex: '#4d96ff', outline: '#1b3f75' },
  { name: 'Neon Emerald', hex: '#2ecc71', outline: '#145a32' },
  { name: 'Sunset Coral', hex: '#ff7675', outline: '#7b2625' },
  { name: 'Phantom Purple', hex: '#8854d0', outline: '#3d1c68' },
  { name: 'Obsidian Midnight', hex: '#2d3436', outline: '#111415' }
];

export const BACKGROUNDS = [
  { name: 'Deep Void', fill: '#17142a', accent: '#211c39' },
  { name: 'Retro Grid', fill: '#211c39', accent: '#3b2f5b' },
  { name: 'Pastel Meadow', fill: '#e8f5e9', accent: '#c8e6c9' },
  { name: 'Sunset Horizon', fill: '#fab1a0', accent: '#ffeaa7' },
  { name: 'Starry Abyss', fill: '#0c1021', accent: '#1b2a47' },
  { name: 'Royal Velvet', fill: '#2d132c', accent: '#4a1e49' },
  { name: 'Mint Tea', fill: '#dff9fb', accent: '#c7ecee' },
  { name: 'Warm Sunrise', fill: '#ffecd2', accent: '#fcb69f' },
  { name: 'Bubblegum Dream', fill: '#ffd1ff', accent: '#fad0c4' },
  { name: 'Terminal Green', fill: '#0d1117', accent: '#161b22' }
];

export const EXPRESSIONS = [
  { id: 'joyful', name: 'Joyful' },
  { id: 'wink', name: 'Wink' },
  { id: 'shades', name: 'Cool Shades' },
  { id: 'star_eyes', name: 'Star Eyes' },
  { id: 'sleepy', name: 'Sleepy zZ' },
  { id: 'loving', name: 'Loving Blush' },
  { id: 'laser', name: 'Laser Eyes' },
  { id: 'grin', name: 'Cheerful Grin' }
];

export const ACCESSORIES = [
  { id: 'none', name: 'None' },
  { id: 'party_hat', name: 'Party Hat' },
  { id: 'crown', name: 'Royal Crown' },
  { id: 'straw_hat', name: 'Straw Hat' },
  { id: 'halo', name: 'Angel Halo' },
  { id: 'beanie', name: 'Winter Beanie' },
  { id: 'strawberry', name: 'Strawberry Snack' },
  { id: 'orb', name: 'Mystic Orb' },
  { id: 'bubble', name: 'Bubble Shield' },
  { id: 'bow_tie', name: 'Bow Tie' }
];

// Simple deterministic PRNG using seed
function prng(seed) {
  let s = Number(BigInt(seed) % 2147483647n);
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateTraits(seedOrTokenId) {
  const rand = prng(typeof seedOrTokenId === 'number' ? seedOrTokenId * 104729 + 7919 : seedOrTokenId);
  
  const shape = SHAPES[Math.floor(rand() * SHAPES.length)];
  const color = COLORS[Math.floor(rand() * COLORS.length)];
  const background = BACKGROUNDS[Math.floor(rand() * BACKGROUNDS.length)];
  const expression = EXPRESSIONS[Math.floor(rand() * EXPRESSIONS.length)];
  const accessory = ACCESSORIES[Math.floor(rand() * ACCESSORIES.length)];

  return { shape, color, background, expression, accessory };
}

export function renderSVG(traits, size = 320) {
  const { shape, color, background, expression, accessory } = traits;

  // Background layers
  let bgElements = `<rect width="100%" height="100%" fill="${background.fill}"/>`;
  if (background.name === 'Retro Grid') {
    bgElements += `
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="${background.accent}" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" opacity="0.6"/>
    `;
  } else if (background.name === 'Starry Abyss' || background.name === 'Deep Void') {
    bgElements += `
      <circle cx="50" cy="40" r="1.5" fill="#fff" opacity="0.8"/>
      <circle cx="280" cy="70" r="1.5" fill="#fff" opacity="0.7"/>
      <circle cx="250" cy="220" r="1.2" fill="#fff" opacity="0.9"/>
      <circle cx="40" cy="250" r="1.5" fill="#fff" opacity="0.6"/>
      <circle cx="160" cy="30" r="2" fill="#ffd54f" opacity="0.9"/>
    `;
  }

  // Feet
  let feet = `
    <rect x="120" y="240" width="30" height="15" rx="6" fill="${color.outline}"/>
    <rect x="170" y="240" width="30" height="15" rx="6" fill="${color.outline}"/>
  `;

  // Ears & Base silhouette depending on shape
  let ears = '';
  let bodyRadius = '35% 35% 28% 28%';
  let bodyStyle = '';

  switch (shape.id) {
    case 'cat':
      ears = `
        <polygon points="105,95 125,50 145,95" fill="${color.hex}" stroke="${color.outline}" stroke-width="8" stroke-linejoin="round"/>
        <polygon points="175,95 195,50 215,95" fill="${color.hex}" stroke="${color.outline}" stroke-width="8" stroke-linejoin="round"/>
      `;
      break;
    case 'blob':
      ears = '';
      bodyRadius = '48% 48% 36% 36%';
      break;
    case 'robot':
      ears = `
        <rect x="156" y="52" width="8" height="25" fill="${color.outline}"/>
        <circle cx="160" cy="48" r="8" fill="${color.hex}" stroke="${color.outline}" stroke-width="4"/>
      `;
      bodyRadius = '8px';
      break;
    case 'bunny':
      ears = `
        <rect x="115" y="28" width="24" height="75" rx="12" fill="${color.hex}" stroke="${color.outline}" stroke-width="8"/>
        <rect x="181" y="28" width="24" height="75" rx="12" fill="${color.hex}" stroke="${color.outline}" stroke-width="8"/>
      `;
      break;
    case 'dog':
      ears = `
        <rect x="85" y="100" width="32" height="60" rx="16" transform="rotate(-30 85 100)" fill="${color.hex}" stroke="${color.outline}" stroke-width="8"/>
        <rect x="205" y="85" width="32" height="60" rx="16" transform="rotate(30 205 85)" fill="${color.hex}" stroke="${color.outline}" stroke-width="8"/>
      `;
      break;
    case 'bear':
      ears = `
        <circle cx="112" cy="95" r="22" fill="${color.hex}" stroke="${color.outline}" stroke-width="8"/>
        <circle cx="208" cy="95" r="22" fill="${color.hex}" stroke="${color.outline}" stroke-width="8"/>
      `;
      break;
    case 'frog':
      ears = `
        <circle cx="120" cy="95" r="22" fill="${color.hex}" stroke="${color.outline}" stroke-width="8"/>
        <circle cx="200" cy="95" r="22" fill="${color.hex}" stroke="${color.outline}" stroke-width="8"/>
        <circle cx="120" cy="95" r="8" fill="#fff"/>
        <circle cx="200" cy="95" r="8" fill="#fff"/>
        <circle cx="120" cy="95" r="4" fill="#121212"/>
        <circle cx="200" cy="95" r="4" fill="#121212"/>
      `;
      bodyRadius = '45% 45% 32% 32%';
      break;
    case 'turtle':
      ears = '';
      bodyRadius = '45% 45% 35% 35%';
      bodyStyle = `box-shadow: inset 0 0 0 10px ${color.outline};`;
      break;
  }

  // Expression
  let eyes = '';
  let mouth = `<rect x="156" y="175" width="8" height="6" rx="2" fill="${color.outline}"/>`;
  let cheeks = `
    <rect x="110" y="165" width="16" height="8" rx="4" fill="#ff82a7"/>
    <rect x="194" y="165" width="16" height="8" rx="4" fill="#ff82a7"/>
  `;

  switch (expression.id) {
    case 'joyful':
      eyes = `
        <rect x="126" y="132" width="14" height="22" rx="4" fill="${color.outline}"/>
        <rect x="180" y="132" width="14" height="22" rx="4" fill="${color.outline}"/>
        <circle cx="130" cy="138" r="3" fill="#fff"/>
        <circle cx="184" cy="138" r="3" fill="#fff"/>
      `;
      break;
    case 'wink':
      eyes = `
        <rect x="126" y="132" width="14" height="22" rx="4" fill="${color.outline}"/>
        <circle cx="130" cy="138" r="3" fill="#fff"/>
        <path d="M 178 144 Q 188 136 198 144" stroke="${color.outline}" stroke-width="5" fill="none" stroke-linecap="round"/>
      `;
      break;
    case 'shades':
      eyes = `
        <polygon points="115,130 150,130 145,152 120,152" fill="#111" stroke="#333" stroke-width="2"/>
        <polygon points="170,130 205,130 200,152 175,152" fill="#111" stroke="#333" stroke-width="2"/>
        <line x1="150" y1="135" x2="170" y2="135" stroke="#111" stroke-width="4"/>
        <line x1="120" y1="134" x2="145" y2="148" stroke="#fff" stroke-width="2" opacity="0.6"/>
        <line x1="175" y1="134" x2="200" y2="148" stroke="#fff" stroke-width="2" opacity="0.6"/>
      `;
      break;
    case 'star_eyes':
      eyes = `
        <polygon points="133,130 136,138 144,138 138,143 140,151 133,146 126,151 128,143 122,138 130,138" fill="#ffd700"/>
        <polygon points="187,130 190,138 198,138 192,143 194,151 187,146 180,151 182,143 176,138 184,138" fill="#ffd700"/>
      `;
      break;
    case 'sleepy':
      eyes = `
        <line x1="124" y1="142" x2="142" y2="142" stroke="${color.outline}" stroke-width="5" stroke-linecap="round"/>
        <line x1="178" y1="142" x2="196" y2="142" stroke="${color.outline}" stroke-width="5" stroke-linecap="round"/>
      `;
      cheeks += `<text x="215" y="115" font-family="sans-serif" font-weight="bold" font-size="20" fill="#9c88ff">zZ</text>`;
      break;
    case 'loving':
      eyes = `
        <path d="M 125 140 A 6 6 0 0 1 137 140 A 6 6 0 0 1 149 140 Q 137 155 125 140" fill="#ff4757"/>
        <path d="M 175 140 A 6 6 0 0 1 187 140 A 6 6 0 0 1 199 140 Q 187 155 175 140" fill="#ff4757"/>
      `;
      break;
    case 'laser':
      eyes = `
        <circle cx="133" cy="142" r="7" fill="#ff0055"/>
        <circle cx="187" cy="142" r="7" fill="#ff0055"/>
        <line x1="133" y1="142" x2="0" y2="180" stroke="#ff0055" stroke-width="4" opacity="0.8"/>
        <line x1="187" y1="142" x2="0" y2="195" stroke="#ff0055" stroke-width="4" opacity="0.8"/>
      `;
      break;
    case 'grin':
      eyes = `
        <rect x="126" y="132" width="14" height="22" rx="4" fill="${color.outline}"/>
        <rect x="180" y="132" width="14" height="22" rx="4" fill="${color.outline}"/>
        <circle cx="130" cy="138" r="3" fill="#fff"/>
        <circle cx="184" cy="138" r="3" fill="#fff"/>
      `;
      mouth = `<path d="M 150 172 Q 160 186 170 172 Z" fill="#ff4757" stroke="${color.outline}" stroke-width="3"/>`;
      break;
  }

  // Accessory
  let accElement = '';
  switch (accessory.id) {
    case 'party_hat':
      accElement = `
        <polygon points="160,35 140,85 180,85" fill="#ff4757" stroke="#ffd700" stroke-width="3"/>
        <circle cx="160" cy="32" r="6" fill="#ffd700"/>
      `;
      break;
    case 'crown':
      accElement = `
        <polygon points="140,75 140,60 150,68 160,56 170,68 180,60 180,75" fill="#ffd700" stroke="#b7791f" stroke-width="2"/>
        <circle cx="160" cy="56" r="3" fill="#e74c3c"/>
      `;
      break;
    case 'straw_hat':
      accElement = `
        <ellipse cx="160" cy="80" rx="48" ry="12" fill="#eccc68" stroke="#b58d3d" stroke-width="2"/>
        <rect x="140" y="60" width="40" height="20" rx="4" fill="#eccc68" stroke="#b58d3d" stroke-width="2"/>
        <rect x="140" y="74" width="40" height="5" fill="#ff4757"/>
      `;
      break;
    case 'halo':
      accElement = `
        <ellipse cx="160" cy="55" rx="36" ry="10" fill="none" stroke="#ffeaa7" stroke-width="6"/>
      `;
      break;
    case 'beanie':
      accElement = `
        <path d="M 125 90 C 125 55 195 55 195 90 Z" fill="#34495e" stroke="#2c3e50" stroke-width="3"/>
        <circle cx="160" cy="54" r="8" fill="#e74c3c"/>
      `;
      break;
    case 'strawberry':
      accElement = `
        <circle cx="160" cy="210" r="12" fill="#ff4757"/>
        <polygon points="156,196 164,196 160,192" fill="#2ecc71"/>
        <circle cx="157" cy="208" r="1.5" fill="#fff"/>
        <circle cx="163" cy="212" r="1.5" fill="#fff"/>
      `;
      break;
    case 'orb':
      accElement = `
        <circle cx="235" cy="180" r="18" fill="#00d2d3" opacity="0.8"/>
        <circle cx="230" cy="175" r="6" fill="#fff" opacity="0.9"/>
      `;
      break;
    case 'bubble':
      accElement = `
        <circle cx="160" cy="160" r="110" fill="none" stroke="#70a1ff" stroke-width="4" opacity="0.5"/>
        <ellipse cx="120" cy="90" rx="15" ry="8" transform="rotate(-30 120 90)" fill="#fff" opacity="0.6"/>
      `;
      break;
    case 'bow_tie':
      accElement = `
        <polygon points="150,195 160,200 150,205" fill="#e74c3c"/>
        <polygon points="170,195 160,200 170,205" fill="#e74c3c"/>
        <circle cx="160" cy="200" r="4" fill="#c0392b"/>
      `;
      break;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="${size}" height="${size}">
    ${bgElements}
    ${feet}
    ${ears}
    <!-- Body -->
    <rect x="100" y="85" width="120" height="150" rx="42" fill="${color.hex}" stroke="${color.outline}" stroke-width="10"/>
    ${cheeks}
    ${eyes}
    ${mouth}
    ${accElement}
  </svg>`;
}

export function generateMetadata(tokenId) {
  const traits = generateTraits(tokenId);
  const svg = renderSVG(traits);
  const base64Svg = Buffer.from(svg).toString('base64');

  return {
    name: `TinyFren #${tokenId}`,
    description: `A unique TinyFren pocket companion living permanently on-chain. Shape: ${traits.shape.name}, Color: ${traits.color.name}.`,
    image: `data:image/svg+xml;base64,${base64Svg}`,
    attributes: [
      { trait_type: 'Shape', value: traits.shape.name },
      { trait_type: 'Color', value: traits.color.name },
      { trait_type: 'Background', value: traits.background.name },
      { trait_type: 'Expression', value: traits.expression.name },
      { trait_type: 'Accessory', value: traits.accessory.name }
    ]
  };
}

// Generate sample preview files
const outDir = resolve(__dirname, '../dist/permutations');
mkdirSync(outDir, { recursive: true });

console.log('--- TinyFrens Permutation Matrix ---');
console.log(`Shapes: ${SHAPES.length}`);
console.log(`Colors: ${COLORS.length}`);
console.log(`Backgrounds: ${BACKGROUNDS.length}`);
console.log(`Expressions: ${EXPRESSIONS.length}`);
console.log(`Accessories: ${ACCESSORIES.length}`);
console.log(`Total Unique Permutations: ${SHAPES.length * COLORS.length * BACKGROUNDS.length * EXPRESSIONS.length * ACCESSORIES.length}`);

// Generate 8 sample SVGs (one for each shape)
for (let i = 1; i <= 8; i++) {
  const traits = generateTraits(i);
  traits.shape = SHAPES[i - 1]; // Ensure each of the 8 shapes is demonstrated
  const svg = renderSVG(traits);
  const meta = {
    name: `TinyFren #${i} (${traits.shape.name})`,
    attributes: [
      { trait_type: 'Shape', value: traits.shape.name },
      { trait_type: 'Color', value: traits.color.name },
      { trait_type: 'Background', value: traits.background.name },
      { trait_type: 'Expression', value: traits.expression.name },
      { trait_type: 'Accessory', value: traits.accessory.name }
    ]
  };
  writeFileSync(resolve(outDir, `fren-${i}-${traits.shape.id}.svg`), svg, 'utf-8');
  writeFileSync(resolve(outDir, `fren-${i}-${traits.shape.id}.json`), JSON.stringify(meta, null, 2), 'utf-8');
}

console.log(`Wrote 8 diverse samples to ${outDir}`);
