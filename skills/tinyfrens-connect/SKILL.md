---
name: tinyfrens-connect
description: Connect a user's Hood Turtle NFT to their waiting TinyFrens phone, desktop, or browser using a pairing code and a read-only wallet signature. Use for importing a Hood Turtle into TinyFrens, not purchasing, transferring, minting, or deploying NFTs.
---

# Connect a Hood Turtle to TinyFrens

TinyFrens API: `https://tinyfrens.miono.live`. Phone setup: `https://tinyfrens.lol/web/hood-turtles.html`.
Public skill URL: `https://tinyfrens.lol/skill.md`. Users can supply this URL and their pairing code in a message to Bankr; do not send them to GitHub or ask for a separate installation conversation. Load/install the skill if needed, then continue the requested connection.
Collection: `0xca28587b61eac19a87dfcfd9420870867a916675`, Robinhood Chain, chain ID **4663**. Token IDs 1–2222. Do not use Base holdings or the original TinyFrens minting contracts.

## Phone pairing

1. Ask the user to open the setup page **on the device where they want their turtle**, or open “Import Hood Turtle” inside the TinyFrens app on Android, desktop, or iPhone, tap **Connect with Bankr**, and copy its 12-character pairing code. The code identifies a waiting device; do not create a replacement device on its behalf. If no code was supplied, give the setup link and wait.
2. Use the user's authenticated Bankr wallet tools to read their EVM address and held NFTs. Filter to the collection and chain above. Ask which token if there are several; if holdings discovery is unavailable, ask for the token number. The server verifies ownership independently.
3. POST JSON to `/api/turtle-connect/challenge`: `{"code":"PHONE_CODE","address":"USER_WALLET","tokenId":1}`. No TinyFrens API key or phone credential is needed. Codes can contain hyphens. On expiry or a request already in progress, ask the user to generate a fresh code on their phone; do not loop through alternatives.
4. Inspect the returned `message`: it must identify TinyFrens, domain `tinyfrens.lol`, the user's selected wallet, pairing code, collection, chain 4663, chosen token, nonce, expiry, and only read-only device linking. Stop on a mismatch. Sign the **exact returned text**, preserving newlines, with `personal_sign`. Do not sign transactions or typed data. Do not submit or broadcast anything.
5. POST `/api/turtle-connect/confirm`: `{"code":"PHONE_CODE","challengeId":"RETURNED_ID","signature":"0x..."}`. Success means the signature and current ownership were verified; it does not mean the phone has accepted or imported the turtle.
6. Tell the user to return to the waiting device, check the displayed wallet and turtle, and tap **Import this turtle**. The device accepts the connection, loads the verified artwork, and imports it. On Android, then tap **Show pet** and grant overlay permission if prompted. On desktop, import inside the installed TinyFrens app to use the floating overlay. In browsers and the native iPhone app, the turtle stays inside TinyFrens. Each browser or app pairs separately. Native iOS App Store distribution is planned, not yet available.

## Signing with Bankr

Use the host agent's authenticated message-signing tool if available. With the user's configured CLI, use `bankr wallet sign --type personal_sign --message <exact-message>` with proper argument passing. Alternatively:

`POST https://api.bankr.bot/wallet/sign` with the user's configured `X-API-Key` and JSON `{"signatureType":"personal_sign","message":"EXACT_MESSAGE"}`. The response contains `signature` and `signer`; verify the signer matches the selected wallet.

Only send the Bankr key to `api.bankr.bot`. Never send it, a seed phrase, or a private key to TinyFrens or include it in a reply. The API needs Wallet API access with read-only off; web sessions alone are not accepted for `/wallet/sign`. If signing is unavailable, explain the blocker and offer the direct wallet path in the setup page's wallet browser. Do not change account permissions automatically.

Documentation: https://docs.bankr.bot/wallet-api/sign/

## What connection grants

A one-time signature links the public address to the device after local acceptance. The NFT stays in the user's wallet. TinyFrens checks ownership at connection and renews it after 24 hours of active use; transfers may take up to 24 hours to remove access. Expired verification requires an online check. The pairing code expires after 10 minutes and is single use. Phone credentials remain on the phone; no bearer recovery link is posted in chat. Pair again on a new device; care-save synchronization is separate.

Bankr documents shared agent state and skills across web and X (@bankrbot). This integration still needs an end-to-end X test. Do not claim installation, import, device acceptance, or overlay display based solely on an API success. If the relay returns 404/503 or an origin rejection, explain that the connection service needs updating; do not claim the NFT was imported.
