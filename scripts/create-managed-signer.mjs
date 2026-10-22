import { Configuration, NeynarAPIClient } from "@neynar/nodejs-sdk";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";

const options = {
  key: { type: "string" },
  mnemonic: { type: "string" },
  fid: { type: "string" },
  help: { type: "boolean", short: "h" }
};

const { values } = parseArgs({ options, allowPositionals: true });

if (values.help) {
  console.log(`
Neynar Managed Signer Generator (Official Docs Spec)
Usage:
  node scripts/create-managed-signer.mjs --key 0x<CustodyPrivateKey>
  or
  node scripts/create-managed-signer.mjs --mnemonic "word1 word2 ... word12"
`);
  process.exit(0);
}

const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
if (!NEYNAR_API_KEY) {
  console.error("Error: NEYNAR_API_KEY is required.");
  process.exit(1);
}
const client = new NeynarAPIClient(new Configuration({ apiKey: NEYNAR_API_KEY }));

// Read key or mnemonic from args or env or .secrets/
let secret = values.key || values.mnemonic || process.env.FARCASTER_DEVELOPER_PRIVATE_KEY || process.env.FARCASTER_DEVELOPER_MNEMONIC;

if (!secret) {
  const secretPath = path.join(process.cwd(), ".secrets", "signer.env");
  if (fs.existsSync(secretPath)) {
    const content = fs.readFileSync(secretPath, "utf-8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const k = match[1].trim();
        const v = match[2].trim().replace(/^["']|["']$/g, "");
        if (k === "FARCASTER_DEVELOPER_PRIVATE_KEY" || k === "PRIVATE_KEY") secret = v;
        if (k === "FARCASTER_DEVELOPER_MNEMONIC" || k === "MNEMONIC") secret = v;
      }
    }
  }
}

if (!secret) {
  console.error(`
Error: No developer wallet private key or mnemonic provided.
Please run with:
  node scripts/create-managed-signer.mjs --key 0x...
or
  node scripts/create-managed-signer.mjs --mnemonic "twelve words..."
or save it in .secrets/signer.env
`);
  process.exit(1);
}

let account;
if (secret.trim().startsWith("0x") || secret.trim().length === 64) {
  const pk = secret.trim().startsWith("0x") ? secret.trim() : "0x" + secret.trim();
  account = privateKeyToAccount(pk);
} else {
  account = mnemonicToAccount(secret.trim());
}

console.log(`\n1. Wallet address: ${account.address}`);

let fid = values.fid ? Number(values.fid) : null;
if (!fid) {
  try {
    const { user } = await client.lookupUserByCustodyAddress({ custodyAddress: account.address });
    fid = Number(user.fid);
    console.log(`2. Found Farcaster FID for custody address: ${fid} (@${user.username})`);
  } catch (err) {
    console.warn(`Could not lookup FID automatically for ${account.address}: ${err.message}`);
    fid = 3354306; // Fallback to @tinyfrens
    console.log(`Using fallback FID: ${fid}`);
  }
} else {
  console.log(`2. Using FID: ${fid}`);
}

console.log(`\n3. Creating managed signer on Neynar...`);
const createSigner = await client.createSigner();
console.log(`   Signer UUID: ${createSigner.signer_uuid}`);
console.log(`   Public Key:  ${createSigner.public_key}`);

console.log(`\n4. Generating EIP-712 SignedKeyRequest signature...`);
const deadline = Math.floor(Date.now() / 1000) + 86400; // 24 hours
const signatureHex = await account.signTypedData({
  domain: {
    name: "Farcaster SignedKeyRequestValidator",
    version: "1",
    chainId: 10,
    verifyingContract: "0x00000000FC700472606ED4fA22623Acf62c60553",
  },
  types: {
    SignedKeyRequest: [
      { name: "requestFid", type: "uint256" },
      { name: "key", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "SignedKeyRequest",
  message: {
    requestFid: BigInt(fid),
    key: createSigner.public_key,
    deadline: BigInt(deadline),
  },
});

console.log(`\n5. Registering signed key with Neynar (sponsored)...`);
const signedKey = await client.registerSignedKey({
  signerUuid: createSigner.signer_uuid,
  appFid: fid,
  deadline,
  signature: signatureHex,
  sponsor: {
    sponsored_by_neynar: true
  }
});

console.log("\n========================================================");
console.log("  SUCCESS! Managed Signer Created and Registered");
console.log("========================================================");
console.log(`Signer UUID:  ${signedKey.signer_uuid}`);
console.log(`Status:       ${signedKey.status}`);
console.log(`Approval URL: ${signedKey.signer_approval_url}`);
console.log("========================================================");
console.log("\nACTION REQUIRED:");
console.log("Open this URL on your phone or in Warpcast (logged into @tinyfrens) to approve:");
console.log(`\n  ${signedKey.signer_approval_url}\n`);

console.log("Waiting for approval... (polling Neynar every 3s)");
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 3000));
  try {
    const check = await client.lookupSigner({ signerUuid: signedKey.signer_uuid });
    if (check.status === "approved") {
      console.log("\n🎉 SIGNER IS APPROVED! Account is connected!");
      console.log(`Signer UUID: ${signedKey.signer_uuid}`);
      process.exit(0);
    } else {
      process.stdout.write(".");
    }
  } catch (e) {
    process.stdout.write("?");
  }
}
console.log("\nPolling timed out. Check status later with lookupSigner.");
