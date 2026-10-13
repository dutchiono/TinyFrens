const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Testing vote page UI & client logic...');

const htmlPath = path.join(__dirname, '..', 'web', 'vote.html');
const jsPath = path.join(__dirname, '..', 'web', 'vote.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

// 1. Verify redundant wallet connection elements are removed from HTML and JS
assert(!html.includes('connectVoteWallet'), 'connectVoteWallet must be removed from vote.html');
assert(!html.includes('Your voting wallet'), 'Outdated "Your voting wallet" title must be removed from vote.html');
assert(!js.includes('connectVoteWallet'), 'connectVoteWallet must be removed from vote.js');
assert(!js.includes('window.ethereum'), 'Redundant window.ethereum connection must be removed from vote.js');
assert(!js.includes('eth_requestAccounts'), 'eth_requestAccounts must be removed from vote.js');

// 2. Verify deposited balance elements and voting actions exist
assert(html.includes('voteBalanceDisplay'), 'voteBalanceDisplay element must exist in vote.html');
assert(html.includes('depositInfoPanel'), 'depositInfoPanel element must exist in vote.html');
assert(html.includes('voteDepositAddress'), 'voteDepositAddress element must exist in vote.html');
assert(html.includes('confirmVote'), 'confirmVote button must exist in vote.html');

// 3. Verify vote endpoints and event dispatching in vote.js
assert(js.includes('/api/vote/status'), 'vote.js must query /api/vote/status');
assert(js.includes('/api/collections/vote'), 'vote.js must submit votes to /api/collections/vote');
assert(js.includes('tinyfrens-balance-updated'), 'vote.js must dispatch/listen to tinyfrens-balance-updated');
assert(js.includes('tinyfrens-account-synced'), 'vote.js must refresh on tinyfrens-account-synced');

// 4. Verify rank and vote badge rendering in collections listing
assert(js.includes('collection-votes-badge'), 'vote.js must render collection-votes-badge');
assert(js.includes('quick-vote-btn'), 'vote.js must render quick-vote-btn');

console.log('✅ ALL VOTE CLIENT VERIFICATIONS PASSED SUCCESSFULLY!');
