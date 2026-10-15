import { createHash } from 'node:crypto';

export const NFT_MAX_SUPPLY = 2664;
export const NET_STORAGE_ADDRESS = '0x00000000DB40fcB9f4466330982372e27Fd7Bbf5';

export const VALID_CUSTOM_EXPRESSIONS = new Set([
  'happy',
  'wink',
  'shades',
  'star_eyes',
  'sleepy',
  'loving',
  'laser',
  'grin',
]);

export const VALID_CUSTOM_ACCESSORIES = new Set([
  'none',
  'party_hat',
  'crown',
  'straw_hat',
  'halo',
  'beanie',
  'strawberry',
  'orb',
  'bubble',
  'bow_tie',
]);

export interface DerivedNftTraits {
  shape: string;
  color: string;
  expression: string;
  accessory: string;
}

export interface NftTraitsRecord {
  shape: string;
  species: string;
  palette: string;
  color: string;
  tier: string;
  expression: string;
  expressionLabel: string;
  accessory: string;
  accessoryLabel: string;
  era: string;
  habitat: string;
  motion: string;
  tokenId: number;
  vaultBacked?: boolean;
  lockedFrens?: string;
}

const PALETTES: readonly [string, string, string][] = [
  ['Lavender Dream', '#a474f1', 'Classic'],
  ['Cyber Neon', '#66c7d2', 'Classic'],
  ['Sunny Amber', '#ffb95e', 'Classic'],
  ['Mint Meadow', '#82eba1', 'Classic'],
  ['Bubblegum', '#ff82a7', 'Classic'],
  ['Electric Blue', '#4d96ff', 'Classic'],
  ['Midnight Obsidian', '#76638e', 'Rare'],
  ['24K Solid Gold', '#ffd700', 'Legendary'],
];

const EXPR_KEYS = ['happy', 'wink', 'shades', 'star_eyes'] as const;
const EXPR_LABELS = ['Classic Happy', 'Playful Wink', 'Cool Shades', 'Star Eyes'] as const;
const ACC_KEYS = ['none', 'party_hat', 'crown', 'halo', 'bow_tie', 'orb'] as const;
const ACC_LABELS = ['None', 'Party Hat', 'Royal Crown', 'Angel Halo', 'Dapper Bow Tie', 'Mystic Orb'] as const;
const ERA_LABELS = ['Pocket Genesis', 'Street Wanderers', 'Dream Garden'] as const;
const HABITAT_LABELS = ['Moonlit Plaza', 'Neon Crosswalk', 'Snack Garden', 'Cloud Room', 'Arcade Alley', 'Tiny Meadow'] as const;
const MOTION_LABELS = ['Happy Walk', 'Bouncy Strut', 'Sleepy Drift', 'Excited Wiggle'] as const;

/**
 * Derives traits deterministically from an arbitrary external NFT object.
 * Matches Python `nft_traits(nft)` in server/app.py.
 */
export function nftTraits(nft: any): DerivedNftTraits {
  const collectionAddr = (nft && typeof nft === 'object' && nft.collection && typeof nft.collection === 'object')
    ? (nft.collection.address ?? '')
    : '';

  const seed = [
    nft?.chain ?? '',
    nft?.tokenId ?? '',
    nft?.name ?? '',
  ].map(String).join(':') + ':' + String(collectionAddr);

  const digest = createHash('sha256').update(seed, 'utf8').digest();
  const shapes = ['cat', 'robot', 'frog', 'turtle'];
  const colors = ['#a474f1', '#66c7d2', '#ffb95e', '#82eba1', '#ff82a7', '#4d96ff', '#76638e', '#ffd700'];
  const exprs = ['happy', 'wink', 'shades', 'star_eyes'];
  const accs = ['none', 'party_hat', 'crown', 'halo', 'bow_tie', 'orb'];

  return {
    shape: shapes[digest[0] % shapes.length],
    color: colors[digest[1] % colors.length],
    expression: exprs[digest[2] % exprs.length],
    accessory: accs[digest[3] % accs.length],
  };
}

/**
 * Derives base traits deterministically by TinyFrens token ID (1..2664).
 * Matches Python `nft_traits_by_id(token_id)` in server/app.py.
 */
export function nftTraitsById(tokenId: number | string): NftTraitsRecord {
  const tid = parseInt(String(tokenId), 10);
  if (isNaN(tid) || tid < 1) {
    throw new Error('Choose a TinyFren token first.');
  }

  const artIndex = (((tid - 1) % 888) * 197 + 17) % 4608;
  const pal = PALETTES[artIndex % PALETTES.length];
  const combination = Math.floor(artIndex / PALETTES.length);
  const eIdx = combination % EXPR_KEYS.length;
  const aIdx = Math.floor(combination / 4) % ACC_KEYS.length;
  const eraIdx = Math.min(2, Math.floor((tid - 1) / 888));
  const habitatIdx = Math.floor(combination / 24) % HABITAT_LABELS.length;
  const motionIdx = Math.floor(combination / 144) % MOTION_LABELS.length;

  return {
    shape: 'robot',
    species: 'Robot',
    palette: pal[0],
    color: pal[1],
    tier: pal[2],
    expression: EXPR_KEYS[eIdx],
    expressionLabel: EXPR_LABELS[eIdx],
    accessory: ACC_KEYS[aIdx],
    accessoryLabel: ACC_LABELS[aIdx],
    era: ERA_LABELS[eraIdx],
    habitat: HABITAT_LABELS[habitatIdx],
    motion: MOTION_LABELS[motionIdx],
    tokenId: tid,
  };
}
