# TinyFrens Architecture Handoff: Custodial Fren Pocket Vaults, Magic Link Restore & Dynamic $1.00 USD FRENS Mint

**Branch**: `feat/socials-footer-links-and-chat-dialog`  
**Latest Commit**: `4d86860`  
**Target Merge Branch**: `main`  
**Live Production Backend**: `https://tinyfrens.miono.live` (Service: `tinyfrens-server.service` on `miono`)  
**Web App Target**: `https://tinyfrens.lol` / `https://tinyfrens.lol/web/`  

---

## 1. Executive Summary

This release resolves the wallet security and onboarding bottlenecks for mobile and casual users:
1. **Eliminated Shared Admin Honeypot**: Removed the hardcoded admin address (`0x32ba...` / Bankr honeypot) from all public UI and API payloads.
2. **Deterministic Custodial Fren Pocket Vaults**: Every fren automatically gets a unique, private EVM address on Base (`0x...`) derived deterministically via server HMAC seed. No MetaMask, seed phrases, or wallet connection required.
3. **Frictionless "Magic Link" Backup & 1-Click Restore**: Mobile players can backup and restore their fren identity, traits, and vault across devices with a single URL token (`#restore=<code>`).
4. **Dynamic $1.00 USD NFT Mint Paid in FRENS Tokens**: Integrated a live DexScreener pricing oracle for the FRENS token (`0x1A96226727a1D0a46334b3A4b3878B32B7659ba3` on Base) to dynamically calculate the exact FRENS required to equal **$1.00 USD** at every sale.
5. **Instant In-Game NFT Trait Equipping**: Minting immediately assigns an available curated token (`#1`–`#888`), writes to the vault database, equips on-chain traits/SVG styles, and adds the golden `#tokenId` badge across Web, Plaza, and Android overlays.

---

## 2. Core Architecture & System Changes

### A. Custodial Fren Vault Derivation (`server/app.py`)
- **HMAC Derivation**: `fren_vault_address_and_key(pid)` produces a private key and EVM address using `hmac.new(FREN_VAULT_SEED, f"vault:{pid}".encode(), hashlib.sha256).digest()`.
- **Database Persistence**: Registered in `pet_wallets` table under `mode = 'fren-vault'`.
- **API Response**: `POST /api/bankr/wallet` returns `{ mode: 'fren-vault', evmAddress: '0x...', walletId: 'vault:<pid>' }`.

### B. Dynamic $1.00 USD FRENS Mint Pricing & DexScreener Oracle (`server/app.py`)
- **Live DEX Oracle**:
  - Pool: FRENS on Base (`0x1A96226727a1D0a46334b3A4b3878B32B7659ba3`).
  - Fetches real-time price from `https://api.dexscreener.com/latest/dex/tokens/0x1A96...`.
  - Caches price with a 30-second TTL to avoid rate-limiting.
- **Mathematical Calculation (`calculate_frens_mint_quote(target_usd=1.00)`)**:
  $$\text{frensRequired} = \frac{\text{targetUsd}}{\text{priceUsd}}$$
  $$\text{frensRequiredWei} = \text{int}(\text{frensRequired} \times 10^{18})$$
  $$\text{creditsRequired} = \text{int}(\text{frensRequired} \times 100)$$
- **Endpoints**:
  - `GET /api/nft/price`: Returns live quote `{ targetUsd: 1.0, priceUsd: ..., frensRequired: ..., creditsRequired: ..., expiresAt: ... }`.
  - `POST /api/wallet/mint`:
    - Checks balance in `credit_accounts`.
    - If `checkOnly=true`, returns affordability status and current quote without charging.
    - If balance suffices, deducts credits from `credit_accounts`, records transaction in `credit_ledger` (`reason: 'mint_nft_frens'`).
    - Randomly picks an unused token ID from `1`–`888`.
    - Computes deterministic traits using `nft_traits_by_id(token_id)`.
    - Records NFT in `fren_nfts`.
    - Auto-updates the pet profile in `pets` table and returns `{ success: true, pet, nft, evmAddress, quote }`.

### C. Magic Link Backup & Recovery Flow (`server/app.py`, `web/app.js`, `web/friends.js`)
- **Link Generation**:
  - `POST /api/wallet/magic-link` generates a URL-safe 16-byte token expiring in 30 days.
  - Stored in `magic_links(code, pet_id, created, expires)`.
  - Returns `restoreUrl: "https://tinyfrens.lol/web/#restore=<code>"`.
- **Restoration**:
  - `POST /api/wallet/restore` redeems the code, refreshes session tokens, and returns pet profile and vault address.
  - Client-side startup script in `web/app.js` inspects `location.hash` / `location.search` for `restore=<code>`.
  - On match, it redeems the code, updates `localStorage`, calls `window.TinyFrensFriends.setIdentity(...)` to re-authenticate WebSockets immediately, and renders the restored fren look.

### D. Frontend Redesign (`web/index.html`, `web/wallet.js`, `web/style.css`)
- **Fren Pocket Vault Card**:
  - Clean Base Network pill + Active chip.
  - Readonly input showing the dedicated Fren Vault address.
  - 1-click clipboard copy button with `"✅ Copied!"` feedback.
- **Live Minting Ticker**:
  - Button text dynamically updates with real-time conversion:  
    `✨ Mint TinyFren · $1.00 (~9,523,809.52 FRENS)`
  - Subtext displays live DEX rate:  
    `1 FRENS ≈ $0.0000001050 USD on Base DEX. Fixed $1.00 USD mint.`
- **Magic Link Export Card**:
  - `"🔗 Magic Restore Link"` button displays input box with one-click copy.
- **NFT Collection Grid**:
  - Renders all vault-owned NFTs with `"Wear this look"` button to switch active in-game sprites.

---

## 3. Files Modified & Added

| File | Status | Description |
|---|---|---|
| [`server/app.py`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/server/app.py) | **Modified** | Added DexScreener oracle, $1 mint calculation, `/api/nft/price`, `/api/wallet/mint`, `/api/wallet/magic-link`, `/api/wallet/restore`, `fren_vault_address_and_key`, and `fren_nfts`/`magic_links` schemas. |
| [`server/test_app.py`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/server/test_app.py) | **Modified** | Updated test suite to expect `fren-vault` mode (200 OK); added tests for `/api/nft/price`, minting flow, and magic link generation & redemption. |
| [`web/index.html`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/web/index.html) | **Modified** | Replaced admin wallet UI with Fren Pocket Vault card, dynamic mint card, and magic link recovery container. Updated copy to $1.00 USD. |
| [`web/wallet.js`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/web/wallet.js) | **Rewritten** | Handles Fren Vault address display/copy, fetches `/api/nft/price` ticker, executes minting, handles magic links, and renders owned NFTs. |
| [`web/app.js`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/web/app.js) | **Modified** | Added startup listener for `#restore=<code>` to execute seamless magic link pet restoration. |
| [`web/friends.js`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/web/friends.js) | **Modified** | Added `setIdentity(newId)` to `window.TinyFrensFriends` to cleanly re-authenticate WebSockets upon restoration. |
| [`web/style.css`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/web/style.css) | **Modified** | Added CSS rules for `.fren-vault-card`, `.mint-fren-card`, `.magic-link-box`, and inputs. |
| [`server/indexer.py`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/server/indexer.py) | **Modified** | Fixed `IndexerError` inheritance (`ValueError`) for deposit topic decoding. |
| [`server/requirements.txt`](file:///c:/Users/epj33/Documents/Playground/TinyFrens/server/requirements.txt) | **Modified** | Added `eth-account` dependency. |

---

## 4. Verification & Automated Test Results

### Local Test Suites
```bash
# Server & Wallet Test Suite
python -m unittest discover -s server -p test_app.py
# Result: 31/31 OK (Ran in 2.08s)

# Economy Ledger Test Suite
python -m unittest discover -s server -p test_economy.py
# Result: 33/33 OK (Ran in 0.85s)

# Deposit Router Allocator Test Suite
python -m unittest discover -s server -p test_deposit_allocator.py
# Result: 3/3 OK (Ran in 32.49s against Foundry anvil/forge)
```

### Live Production Server Verification (`miono`)
Deployed updated files (`app.py`, `indexer.py`, `deposit_allocator.py`) to `/home/miono/tinyfrens-server/` and restarted `tinyfrens-server.service`.

Live test verification:
```bash
curl -s -H "Origin: https://tinyfrens.lol" https://tinyfrens.miono.live/api/nft/price
```
Output:
```json
{
  "targetUsd": 1.0,
  "priceUsd": 1.05e-07,
  "frensPriceUsd": 1.05e-07,
  "frensRequired": 9523809.52,
  "frensRequiredWei": "9523809523809524723482624",
  "creditsRequired": 952380952,
  "tokenAddress": "0x1A96226727a1D0a46334b3A4b3878B32B7659ba3",
  "symbol": "FRENS",
  "timestamp": 1791771768,
  "expiresAt": 1791771828
}
```

---

## 5. Orchestrator Merge & Review Checklist

- [ ] **Git Merge**:
  - Pull branch `feat/socials-footer-links-and-chat-dialog` (Commit `4d86860`).
  - Merge into `main` without merge conflicts.
- [ ] **Frontend Deployment (Vercel)**:
  - Ensure Vercel auto-deploy or manual trigger picks up `web/index.html`, `web/wallet.js`, `web/app.js`, `web/friends.js`, and `web/style.css`.
  - Verify `https://tinyfrens.lol/web/#wallet` loads the **Fren Pocket Vault** card without any mention of `0x32ba...`.
- [ ] **Production Server (`miono`)**:
  - Ensure `.env` on `miono` contains `FREN_VAULT_SEED` (already has fallback).
  - Confirm `systemctl --user status tinyfrens-server.service` reports active/running.
- [ ] **DEX Price Oracle Validation**:
  - Verify that the mint button text displays live FRENS price (e.g. `✨ Mint TinyFren · $1.00 (~X FRENS)`).
- [ ] **Magic Link Verification**:
  - Click `"🔗 Magic Restore Link"`, copy the link, open in an incognito window, and confirm the fren profile restores seamlessly.
