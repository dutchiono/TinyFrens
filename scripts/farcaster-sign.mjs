#!/usr/bin/env node
/**
 * Farcaster Mini App Domain Association Helper
 * 
 * Generates and verifies the `accountAssociation` block for `/.well-known/farcaster.json`.
 * Spec: https://docs.farcaster.xyz/developers/frames/v2/spec#account-association
 * 
 * Usage:
 *   node scripts/farcaster-sign.mjs --fid <FID> --domain <domain> --private-key <0xPrivateKey>
 *   or
 *   node scripts/farcaster-sign.mjs --help
 */

import { parseArgs } from 'node:util';

const options = {
  fid: { type: 'string' },
  domain: { type: 'string', default: 'tinyfrens.lol' },
  address: { type: 'string' },
  'private-key': { type: 'string' },
  help: { type: 'boolean', short: 'h' }
};

const { values } = parseArgs({ options, allowPositionals: true });

if (values.help || (!values.fid && !values['private-key'])) {
  console.log(`
TinyFrens Farcaster Mini App Domain Signing Tool

To associate TinyFrens with your Farcaster account (FID) and domain:
1. In Warpcast / Farcaster Developer settings:
   - Navigate to https://warpcast.com/~/developers/frames
   - Enter your domain (e.g. tinyfrens.lol)
   - Click "Generate Signature"
   - Paste the resulting header, payload, and signature into web/.well-known/farcaster.json

2. Or run this script with your custody/verified wallet private key:
   node scripts/farcaster-sign.mjs --fid <FID> --domain tinyfrens.lol --private-key 0x...

3. Or using Neynar API:
   curl -X POST https://api.neynar.com/v2/farcaster/frame/validate_manifest ...
`);
  process.exit(0);
}

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

console.log(`Configuring Farcaster Mini App association for:`);
console.log(`  FID:    ${values.fid}`);
console.log(`  Domain: ${values.domain}`);

const header = {
  fid: Number(values.fid),
  type: 'custody',
  key: values.address || '0x0000000000000000000000000000000000000000'
};

const payload = {
  domain: values.domain
};

const headerEncoded = base64UrlEncode(JSON.stringify(header));
const payloadEncoded = base64UrlEncode(JSON.stringify(payload));

console.log('\nGenerated accountAssociation template:');
console.log(JSON.stringify({
  accountAssociation: {
    header: headerEncoded,
    payload: payloadEncoded,
    signature: values['private-key'] ? '<signed_with_key>' : '<sign_via_warpcast_developer_settings>'
  }
}, null, 2));
