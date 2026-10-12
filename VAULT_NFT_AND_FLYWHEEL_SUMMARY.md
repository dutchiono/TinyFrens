# TinyFrens Dual-Track Vault NFTs & FRENS Economic Flywheel Summary

This document summarizes the complete implementation of dual-track minting, FRENS Piggybank Vault NFTs with unwrapping, and the "Save Changes" FRENS token sink flywheel (50% burn / 50% Treasury).

---

## 1. High-Level Summary

| Feature | Mechanism | Parameters |
| :--- | :--- | :--- |
| **Track A: Buy Outright** | Standard on-chain ERC721A mint paid in ETH. | **0.001 ETH** (~$2.50–$2.60 USD) |
| **Track B: Piggybank Vault** | Mint by locking FRENS tokens directly inside the NFT as intrinsic backing. | **~0.002 ETH worth of FRENS** (47,619,047 FRENS) |
| **Vault Unwrapping** | Owner calls `unwrap(tokenId)` at any time to redeem 100% of the locked FRENS back to their wallet. | Burns the NFT to prevent double-spending; returns locked FRENS. |
| **Save Changes Flywheel** | Changing appearance, traits, reskinning, or renaming an owned NFT charges a fee in FRENS. | **5,000 FRENS** fee: **50% burned** (2,500 FRENS), **50% to Treasury** (2,500 FRENS). |

---

## 2. Smart Contract Implementation

### Files: [`contracts/TinyFrensNFT.sol`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/contracts/TinyFrensNFT.sol), [`contracts/TinyFrensArt.sol`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/contracts/TinyFrensArt.sol)

1. **EIP-170 & EIP-3860 Bytecode Compliance**:
   - `TinyFrensArt` deployed standalone and optimized from 35.6 KB down to **17.4 KB** (margin: `+7,134 B` under 24,576-byte limit).
   - `TinyFrensNFT` runtime size: **15.9 KB** (margin: `+8,632 B` under limit).
   - Parent contract initcode size: **34.9 KB** (margin: `+14,249 B` under the 49,152-byte limit).

2. **Piggybank Vault Functions**:
   - `mintWithVault(uint256 amount, uint256 frensPerToken)`:
     - Verifies `frensPerToken >= frensPerVaultMint` (default `47_619_047 * 10^18`).
     - Transfers FRENS tokens from `msg.sender` into the contract.
     - Mints the tokens and stores collateral in `lockedFrens[tokenId]`.
     - Emits `TinyFrenVaultMinted(tokenId, owner, lockedAmount)`.
   - `depositFrens(uint256 tokenId, uint256 amount)`:
     - Allows owners to add more FRENS collateral to an existing companion NFT.
   - `unwrap(uint256 tokenId)`:
     - Validates token ownership (`_requireTokenOwner(tokenId)`).
     - Deletes `lockedFrens[tokenId]`.
     - Burns the NFT (`_burn(tokenId)`).
     - Transfers 100% of locked FRENS back to the caller.
     - Emits `TinyFrenUnwrapped(tokenId, owner, lockedAmount)`.

3. **On-Chain Metadata Injection**:
   - Vault-backed NFTs automatically append the following traits to `tokenURI`:
     - `{"trait_type": "Vault Backed", "value": "FRENS Piggybank"}`
     - `{"trait_type": "Locked FRENS (Wei)", "value": "<locked_amount>"}`

4. **Foundry Test Suite**:
   - [`contracts/test/TinyFrensNFT.t.sol`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/contracts/test/TinyFrensNFT.t.sol) passes **10/10 tests**.
   - Entire repo passes **84/84 tests** across all 6 test suites.

---

## 3. Server Relay Backend

### Files: [`server/app.py`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/server/app.py), [`server/test_app.py`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/server/test_app.py)

1. **Database Schema Enhancements**:
   - Added `locked_frens TEXT DEFAULT '0'` column to `fren_nfts` table.
   - Added `frens_burn_log` table:
     ```sql
     CREATE TABLE IF NOT EXISTS frens_burn_log(
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       pet_id TEXT,
       token_id INTEGER,
       action TEXT,
       amount_burned TEXT,
       amount_treasury TEXT,
       created INTEGER
     );
     ```

2. **Endpoints**:
   - **`GET /api/nft/price`**:
     Returns dual-track quotes:
     ```json
     {
       "priceEth": 0.001,
       "ethRequired": 0.001,
       "ethRequiredWei": "1000000000000000",
       "vaultEth": 0.002,
       "vaultEthWei": "2000000000000000",
       "vaultFrensRequired": "47619047000000000000000000",
       "vaultFrensHuman": 47619047.0,
       "saveChangesFeeFrens": "5000000000000000000000",
       "saveChangesFeeHuman": 5000.0,
       "burnPercent": 50,
       "treasuryPercent": 50,
       "symbol": "ETH",
       "frensSymbol": "FRENS",
       "chain": "base"
     }
     ```
   - **`POST /api/wallet/mint`**:
     - Accepts `mode: 'eth'` (default) or `mode: 'vault'`.
     - When `mode === 'vault'`, records `locked_frens` and attaches vault traits.
   - **`POST /api/wallet/unwrap-nft`**:
     - Validates ownership and confirms NFT has locked FRENS.
     - Executes on-chain unwrap if contract is configured.
     - Deletes NFT from vault database, resets equipped pet's `tokenId` to `null`.
     - Logs unwrap event to `frens_burn_log`.
     - Returns `{ ok: true, tokenId, frensRedeemed, message }`.
   - **`POST /api/wallet/save-nft-changes`**:
     - Validates ownership.
     - Charges 5,000 FRENS fee (burns 2,500 FRENS, sends 2,500 FRENS to Treasury).
     - Logs fee distribution to `frens_burn_log`.
     - Updates name and traits in database and syncs pet profile.
     - Returns `{ ok: true, tokenId, feeFrens, burnedFrens, treasuryFrens, pet }`.

3. **Python Test Suite**:
   - All **36/36 tests** pass in `test_app.py`.
   - All **77/77 tests** pass across the full test suite in `server/`.

---

## 4. Frontend UI & UX

### Files: [`web/index.html`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/web/index.html), [`web/wallet.js`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/web/wallet.js), [`web/customize.js`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/web/customize.js)

1. **Dual-Track Mint Selector**:
   - Interactive pill tabs on the mint card:
     - `⚡ Buy Outright (0.001 ETH)`
     - `🏦 FRENS Piggybank (~0.002 ETH in FRENS)`
   - Dynamically updates pricing, explanations, and button labels when switched.

2. **Vault Badge & Unwrapping UI**:
   - Vault-backed NFTs display a badge:
     `🏦 FRENS Vault Backed (47,619,047 FRENS locked)`
   - Equipped with a `🔨 Unwrap Fren` button with confirmation prompt:
     *"Unwrap TinyFren #X? The NFT will be burned and 100% of the locked FRENS will be returned to your wallet."*

3. **Save Changes to NFT (50/50 Flywheel)**:
   - On the Wallet tab: `💾 Save Look to NFT` button under On-Chain Pet Actions.
   - In the Customization Studio: when an NFT is equipped, `💾 Save Look to TinyFren #X (50% Burn / 50% Treasury)` appears directly below the mint button.

4. **Build Verification**:
   - `node scripts/build-site.mjs` runs cleanly and updates `/dist`.

---

## 5. Verification Checklist

- [x] Contract bytecode strictly below EIP-170 limit (15.9 KB / 17.4 KB vs 24.5 KB max).
- [x] Contract initcode strictly below EIP-3860 limit (34.9 KB vs 49.1 KB max).
- [x] Dual-track minting supported via 0.001 ETH or 0.002 ETH worth of FRENS tokens.
- [x] Unwrapping mechanism tested and working: burns NFT and returns 100% collateral.
- [x] Save changes flywheel implemented: 50% burned, 50% to Treasury.
- [x] Foundry test suite: **84/84 PASS**.
- [x] Python test suite: **77/77 PASS**.
- [x] Frontend site build: **PASS**.
