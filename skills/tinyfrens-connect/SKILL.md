---
name: tinyfrens-connect
description: Link a user's wallet to their waiting TinyFrens phone, desktop, or browser for supported NFT companions using a pairing code and a read-only wallet signature. Use for connecting a wallet and importing supported NFTs into TinyFrens, not purchasing, transferring, minting, or deploying NFTs.
---

# Connect a wallet to TinyFrens

TinyFrens API: `https://tinyfrens.miono.live`. Phone setup: `https://tinyfrens.lol/web/hood-turtles.html`.
Public skill URL: `https://tinyfrens.lol/import/skill.md`. Users can supply this URL and their pairing code in a message to Bankr; do not send them to GitHub or ask for a separate installation conversation. Load/install the skill if needed, then continue the requested connection.
This skill connects a wallet, independent of collections. Do not reject a wallet connection because an NFT collection is absent from this document. After device acceptance, TinyFrens discovers currently supported NFTs on Refresh NFTs; new collection support does not require another Bankr message or signature. Collection availability is controlled by the app and relay, not this skill. Connecting does not guarantee an NFT has an animation adapter.

## Phone pairing

1. Ask the user to open the setup page **on the destination device**, or open “Connect my wallet” in TinyFrens. The page creates a 12-character code and a ready-to-copy tweet automatically. If no code was supplied, give the setup link and wait. Do not create a replacement device.
2. Read the user's authenticated Bankr EVM wallet address. This links the wallet for all supported collections, including future additions; do not ask for a token number or choose a single NFT.
3. POST JSON to `/api/turtle-connect/challenge`: `{"code":"DEVICE_CODE","address":"USER_WALLET"}`. No TinyFrens API key or device credential is needed. Hyphens are accepted. On expiry, ask for a fresh code from the device.
4. Inspect the returned `message`: it must identify TinyFrens, domain `tinyfrens.lol`, the selected wallet, pairing code, nonce, expiry and read-only device linking. Sign the **exact returned text** with `personal_sign`. Never sign a transaction or spending approval.
5. POST `/api/turtle-connect/confirm`: `{"code":"DEVICE_CODE","challengeId":"RETURNED_ID","signature":"0x..."}`. Success verifies the wallet signature; it does not mean the device accepted or imported anything.
6. Tell the user to return to the device, check the wallet, tap **Accept wallet link**, and choose companions from the supported NFTs found there. Users can add up to five companions separately. Android users then tap **Show pet** and grant overlay permission. Desktop imports use the installed app; browser companions stay inside TinyFrens. Native iOS App Store distribution is planned. Pair each device separately.

## Signing with Bankr

Use the host agent's authenticated message-signing tool if available. With the user's configured CLI, use `bankr wallet sign --type personal_sign --message <exact-message>` with proper argument passing. Alternatively:

`POST https://api.bankr.bot/wallet/sign` with the user's configured `X-API-Key` and JSON `{"signatureType":"personal_sign","message":"EXACT_MESSAGE"}`. The response contains `signature` and `signer`; verify the signer matches the selected wallet.

Only send the Bankr key to `api.bankr.bot`. Never send it, a seed phrase, or a private key to TinyFrens or include it in a reply. The API needs Wallet API access with read-only off; web sessions alone are not accepted for `/wallet/sign`. If signing is unavailable, explain the blocker and offer the direct wallet path in the setup page's wallet browser. Do not change account permissions automatically.

Documentation: https://docs.bankr.bot/wallet-api/sign/

## What connection grants

A one-time signature adds the public address to the device after local acceptance. Existing linked wallets and selected companions remain. Each device can link up to 10 wallets; supported holdings are combined and deduplicated. Remove individual wallets in Import NFTs; their companions are removed from that device. The NFT stays in the user's wallet. TinyFrens discovers supported holdings after connection and verifies each companion before import, renewing after 24 hours of active use; transfers may take up to 24 hours to remove access. Expired verification requires an online check. The pairing code expires after 10 minutes and is single use. Phone credentials remain on the phone; no bearer recovery link is posted in chat. Pair again on a new device; care-save synchronization is separate.

Bankr documents shared agent state and skills across web and X (@bankrbot). This integration still needs an end-to-end X test. Do not claim installation, import, device acceptance, or overlay display based solely on an API success. If the relay returns 404/503 or an origin rejection, explain that the connection service needs updating; do not claim the NFT was imported.
