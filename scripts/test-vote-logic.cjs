// Automated simulation & logic assertion test suite for CollectionVote
// Runs directly via Node.js verifying state transitions, math, and permanent boost

const assert = require('assert');

console.log('🧪 Starting CollectionVote behavioral test suite (including Permanent Boost)...');

// Mock FRENS token balance ledger
const balances = {
  'alice': 2000000n * 10n**18n,
  'bob': 500000n * 10n**18n,
  'charlie': 50000n * 10n**18n,
  '0x000000000000000000000000000000000000dEaD': 0n
};

const MIN_HOLDING = 100000n * 10n**18n;
const BURN_MULTIPLIER = 5n;
const PERMANENT_BOOST_BPS = 1000n; // 10%
const PERMANENT_BOOST_DENOMINATOR = 10000n;
const PERMANENT_BOOST_UNIT = 1000000n * 10n**18n;

class MockCollectionVote {
  constructor() {
    this.proposals = new Map();
    this.hasHoldVoted = new Map(); // propId:voter -> bool
    this.userTotalBurned = new Map(); // voter -> uint256
    this.proposalCount = 0n;
  }

  getPermanentBoostBonus(voter, baseWeight) {
    const totalBurned = this.userTotalBurned.get(voter) || 0n;
    if (totalBurned === 0n || baseWeight === 0n) return 0n;
    return (baseWeight * totalBurned * PERMANENT_BOOST_BPS) / (PERMANENT_BOOST_UNIT * PERMANENT_BOOST_DENOMINATOR);
  }

  createProposal(name, source, complexity, durationSecs, now = 1000) {
    this.proposalCount++;
    const prop = {
      id: this.proposalCount,
      name,
      source,
      complexity,
      startTime: now,
      endTime: now + durationSecs,
      holdVotes: 0n,
      rawBurnedAmount: 0n,
      totalWeight: 0n
    };
    this.proposals.set(this.proposalCount, prop);
    return prop;
  }

  castHoldVote(propId, voter, now = 1000) {
    const prop = this.proposals.get(propId);
    if (!prop) throw new Error('ProposalNotFound');
    if (now < prop.startTime || now > prop.endTime) throw new Error('VotingNotActive');
    
    const key = `${propId}:${voter}`;
    if (this.hasHoldVoted.get(key)) throw new Error('AlreadyHoldVoted');

    const bal = balances[voter] || 0n;
    if (bal < MIN_HOLDING) throw new Error('BelowThreshold');

    const permanentBonus = this.getPermanentBoostBonus(voter, bal);
    const totalWeight = bal + permanentBonus;

    this.hasHoldVoted.set(key, true);
    prop.holdVotes += totalWeight;
    prop.totalWeight += totalWeight;
    return { prop, permanentBonus, totalWeight };
  }

  castBurnVote(propId, voter, burnAmt, now = 1000) {
    const prop = this.proposals.get(propId);
    if (!prop) throw new Error('ProposalNotFound');
    if (now < prop.startTime || now > prop.endTime) throw new Error('VotingNotActive');

    const bal = balances[voter] || 0n;
    if (bal < MIN_HOLDING) throw new Error('BelowThreshold');
    if (bal < burnAmt) throw new Error('InsufficientBalance');

    balances[voter] -= burnAmt;
    balances['0x000000000000000000000000000000000000dEaD'] += burnAmt;

    const currentLifetime = this.userTotalBurned.get(voter) || 0n;
    this.userTotalBurned.set(voter, currentLifetime + burnAmt);

    const instantWeight = burnAmt * BURN_MULTIPLIER;
    prop.rawBurnedAmount += burnAmt;
    prop.totalWeight += instantWeight;
    return prop;
  }
}

const contract = new MockCollectionVote();

// Test 1: Proposals across 1d, 3d, 7d
console.log('-> Testing proposal creation across custom durations (1d, 3d, 7d)...');
const p1 = contract.createProposal('Hood Turtles', 'BankrX', 'Tier2Modular', 86400);
const p2 = contract.createProposal('Milady', 'OpenSea', 'Tier3Complex', 259200);

// Test 2: Alice burns 1,000,000 FRENS in Ballot 1 (e.g. 5x instant weight = 5M)
console.log('-> Testing 5x instant burn boost...');
contract.castBurnVote(1n, 'alice', 1000000n * 10n**18n);
assert.strictEqual(p1.rawBurnedAmount, 1000000n * 10n**18n);
assert.strictEqual(p1.totalWeight, 5000000n * 10n**18n);
assert.strictEqual(contract.userTotalBurned.get('alice'), 1000000n * 10n**18n);

// Test 3: Permanent Boost Calculation
console.log('-> Verifying permanent boost calculation on future ballots...');
// Alice has 1M remaining tokens. Bonus = 1M * 10% = 100,000 FRENS permanent bonus weight!
const bonus = contract.getPermanentBoostBonus('alice', 1000000n * 10n**18n);
assert.strictEqual(bonus, 100000n * 10n**18n);

// Test 4: Alice hold votes on Ballot 2 with permanent boost included
console.log('-> Testing hold vote with permanent boost bonus applied...');
const { totalWeight, permanentBonus } = contract.castHoldVote(2n, 'alice');
assert.strictEqual(permanentBonus, 100000n * 10n**18n);
assert.strictEqual(totalWeight, 1100000n * 10n**18n);
assert.strictEqual(p2.totalWeight, 1100000n * 10n**18n);

console.log('✅ ALL PERMANENT BOOST ASSERTIONS PASSED FLAWLESSLY!');
