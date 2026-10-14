import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  nftTraits,
  nftTraitsById,
  NFT_MAX_SUPPLY,
  NET_STORAGE_ADDRESS,
  VALID_CUSTOM_EXPRESSIONS,
  VALID_CUSTOM_ACCESSORIES,
} from '../../src/domain/nft-traits.js';

describe('Domain: NFT Traits & Generative Parity', () => {
  test('constants match Python reference', () => {
    assert.equal(NFT_MAX_SUPPLY, 2664);
    assert.equal(NET_STORAGE_ADDRESS, '0x00000000DB40fcB9f4466330982372e27Fd7Bbf5');
    assert.ok(VALID_CUSTOM_EXPRESSIONS.has('star_eyes'));
    assert.ok(VALID_CUSTOM_EXPRESSIONS.has('laser'));
    assert.ok(VALID_CUSTOM_ACCESSORIES.has('crown'));
    assert.ok(VALID_CUSTOM_ACCESSORIES.has('party_hat'));
  });

  test('nftTraits derives exact deterministic traits matching Python hash', () => {
    const nft = {
      name: 'TinyFren #42',
      tokenId: '42',
      chain: 'base',
      collection: {
        name: 'TinyFrens',
        address: '0x1234567890abcdef1234567890abcdef12345678',
      },
    };

    const traits = nftTraits(nft);
    // Matches Python test characterization output:
    // {"shape": "robot", "color": "#a474f1", "expression": "star_eyes", "accessory": "crown"}
    assert.deepEqual(traits, {
      shape: 'robot',
      color: '#a474f1',
      expression: 'star_eyes',
      accessory: 'crown',
    });
  });

  test('nftTraits handles missing or non-object fields gracefully', () => {
    const traits = nftTraits({});
    assert.ok(['cat', 'robot', 'frog', 'turtle'].includes(traits.shape));
    assert.ok(traits.color.startsWith('#'));
    assert.ok(['happy', 'wink', 'shades', 'star_eyes'].includes(traits.expression));
    assert.ok(['none', 'party_hat', 'crown', 'halo', 'bow_tie', 'orb'].includes(traits.accessory));
  });

  test('nftTraitsById produces exact traits for milestone token IDs', () => {
    // Token 1
    const t1 = nftTraitsById(1);
    assert.equal(t1.shape, 'robot');
    assert.equal(t1.species, 'Robot');
    assert.equal(t1.palette, 'Cyber Neon');
    assert.equal(t1.color, '#66c7d2');
    assert.equal(t1.tier, 'Classic');
    assert.equal(t1.expression, 'shades');
    assert.equal(t1.expressionLabel, 'Cool Shades');
    assert.equal(t1.accessory, 'none');
    assert.equal(t1.accessoryLabel, 'None');
    assert.equal(t1.era, 'Pocket Genesis');
    assert.equal(t1.habitat, 'Moonlit Plaza');
    assert.equal(t1.motion, 'Happy Walk');
    assert.equal(t1.tokenId, 1);

    // Token 42
    const t42 = nftTraitsById(42);
    assert.equal(t42.palette, 'Midnight Obsidian');
    assert.equal(t42.color, '#76638e');
    assert.equal(t42.tier, 'Rare');
    assert.equal(t42.expression, 'star_eyes');
    assert.equal(t42.expressionLabel, 'Star Eyes');
    assert.equal(t42.era, 'Pocket Genesis');
    assert.equal(t42.habitat, 'Moonlit Plaza');
    assert.equal(t42.motion, 'Excited Wiggle');
    assert.equal(t42.tokenId, 42);

    // Token 888 (End of Pocket Genesis)
    const t888 = nftTraitsById(888);
    assert.equal(t888.era, 'Pocket Genesis');
    assert.equal(t888.palette, 'Bubblegum');
    assert.equal(t888.color, '#ff82a7');

    // Token 889 (Start of Street Wanderers)
    const t889 = nftTraitsById(889);
    assert.equal(t889.era, 'Street Wanderers');
    assert.equal(t889.palette, 'Cyber Neon');
    assert.equal(t889.color, '#66c7d2');

    // Token 2664 (End of Dream Garden)
    const t2664 = nftTraitsById(2664);
    assert.equal(t2664.era, 'Dream Garden');
    assert.equal(t2664.palette, 'Bubblegum');
    assert.equal(t2664.color, '#ff82a7');
  });

  test('nftTraitsById rejects invalid token IDs', () => {
    assert.throws(() => nftTraitsById(0), /Choose a TinyFren token first/);
    assert.throws(() => nftTraitsById(-5), /Choose a TinyFren token first/);
    assert.throws(() => nftTraitsById('invalid'), /Choose a TinyFren token first/);
  });
});
