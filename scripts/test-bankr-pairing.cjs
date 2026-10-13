const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing Bankr on-demand pairing code generation flow...');

const walletLinkJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'wallet-link.js'), 'utf8');
const hoodTurtlesHtml = fs.readFileSync(path.join(__dirname, '..', 'web', 'hood-turtles.html'), 'utf8');
const hoodTurtlesJs = fs.readFileSync(path.join(__dirname, '..', 'web', 'hood-turtles.js'), 'utf8');

// 1. Check wallet-link.js template and behavior
assert(walletLinkJs.includes('id="bankrWalletPrompt" role="button" tabindex="0" aria-label="Copy Bankr connection message" hidden'),
  'bankrWalletPrompt should be initially hidden in wallet-link.js');
assert(walletLinkJs.includes('id="renewWalletPairing" class="secondary pairing-renew">Generate code</button>'),
  'renewWalletPairing should initially say "Generate code"');

// Ensure no auto-start on toggle or initialLoad in wallet-link.js
assert(!walletLinkJs.includes("manager.addEventListener('toggle'"),
  'wallet-link.js must not auto-start pairing on details toggle');
assert(!walletLinkJs.match(/initialLoad\(\)\s*\{[^}]*startPairing\(\)/),
  'wallet-link.js must not auto-start pairing in initialLoad()');

// Ensure startPairing changes button text to 'Generate new code' and unhides prompt
assert(walletLinkJs.includes("renew.textContent = 'Generate new code';"),
  'startPairing should set button text to "Generate new code"');
assert(walletLinkJs.includes("prompt.hidden = false;"),
  'startPairing should unhide prompt');

// Ensure timeout updates message and keeps 'Generate new code'
assert(walletLinkJs.includes("renew.textContent = 'Generate new code';") &&
  walletLinkJs.includes("pairingStatus.textContent = 'This connection code timed out. Tap Generate new code to continue.';"),
  'pollPairing timeout should update status and maintain "Generate new code"');

// Ensure accept resets to 'Generate code' and hides prompt
assert(walletLinkJs.includes("prompt.hidden = true; prompt.textContent = '';") &&
  walletLinkJs.includes("renew.textContent = 'Generate code';"),
  'accept should hide prompt and reset button to "Generate code"');

// 2. Check hood-turtles.html and hood-turtles.js
assert(hoodTurtlesHtml.includes('<button id="connectBankr" class="secondary">Generate code</button>'),
  'hood-turtles.html button should say "Generate code" and not be hidden');
assert(!hoodTurtlesHtml.includes('<button id="connectBankr" class="secondary" hidden>'),
  'hood-turtles.html button should not be hidden initially');

// Check no auto-call of startPairing on ensureIdentity in hood-turtles.js
assert(!hoodTurtlesJs.match(/ensureIdentity\(\)\.then\(async \(\) => \{\s*await startPairing\(\);/),
  'hood-turtles.js must not auto-start pairing on initial load');

// Check hood-turtles.js startPairing sets 'Generate new code'
assert(hoodTurtlesJs.includes("$('connectBankr').textContent = 'Generate new code';"),
  'hood-turtles.js startPairing should set button text to "Generate new code"');

// Check hood-turtles.js acceptPairing resets to 'Generate code'
assert(hoodTurtlesJs.includes("$('connectBankr').textContent = 'Generate code';"),
  'hood-turtles.js acceptPairing should reset button text to "Generate code"');

// Check single button in connect panel
const connectPanelMatches = hoodTurtlesHtml.match(/<button id="connectBankr"[^>]*>[^<]*<\/button>/g);
assert(connectPanelMatches && connectPanelMatches.length === 1,
  'hood-turtles.html should have exactly one connectBankr button');

console.log('✅ ALL BANKR PAIRING FLOW TESTS PASSED!');
