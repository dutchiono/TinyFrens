---
name: tinyfrens-nft
description: Deploy and verify the TinyFrens on-chain generative NFT collection on Robinhood Chain (4663) or Base (8453) with 8 companion species, 2664 max supply (333 per species), 1:1 floating pet vector art, and Net Protocol integration.
metadata: {"bankr":{"emoji":"🐾","requires":{"bins":["forge","cast"]}}}
---

# TinyFrens NFT Collection Skill

**TinyFrens** is a curated, 100% on-chain generative NFT companion collection. Each Fren is rendered directly in SVG with vector geometry matching the in-game floating pet companion 1:1 (`viewBox="0 0 128 148"`). Traits are deterministically curated to ensure zero clipping, zero color clashing, and an exact 1:1 mirror between on-chain tokens and in-game companions. Every mint, transfer, and burn event automatically posts to **Net Protocol**.

---

## 1. Collection Specifications

| Parameter | Value |
|---|---|
| **Collection Name** | `TinyFrens` |
| **Token Symbol** | `FREN` |
| **Max Supply** | `2664` (Exactly 333 tokens per species) |
| **Mint Price** | `0.001 ETH` |
| **Max Mints Per Wallet** | `20` |
| **Creator Reserve** | `20` |
| **Art Type** | Fully On-Chain SVG (1:1 vector twin of in-game floating companion) |
| **Species (8)** | Cat, Blob, Robot, Bunny, Puppy, Bear, Frog, Turtle |
| **Permutation Matrix** | 1,536 curated combinations (8 species × 8 paired palettes × 4 expressions × 6 accessories) |
| **In-Game Sync** | Direct replication via Token ID (`#1–#2664`) across desktop overlay, web app, and multiplayer visit links |
| **Target Networks** | Robinhood Chain (EVM `4663`) or Base (`8453`) |
| **Net Protocol Contract** | `0x00000000B24D62781dB359b07880a105cD0b64e6` |

---

## 2. Deploying via Bankr (@bankrbot)

When prompted to create this collection, execute the following steps:

### Step 1: Scaffold Foundry Workspace

```bash
mkdir tinyfrens-nft && cd tinyfrens-nft
forge init --no-git --no-commit
forge install chiru-labs/ERC721A@v4.3.0 --no-commit
forge install vectorized/solady@v0.0.245 --no-commit
```

Ensure `foundry.toml` contains:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
optimizer = true
optimizer_runs = 200
```

### Step 2: Add Contracts

Save `src/NetIntegratedERC721A.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC721A } from "erc721a/contracts/ERC721A.sol";
import { LibString } from "solady/utils/LibString.sol";

interface INet {
    function sendMessage(
        string calldata text,
        string calldata topic,
        bytes calldata data
    ) external;

    function sendMessageViaApp(
        address sender,
        string calldata text,
        string calldata topic,
        bytes calldata data
    ) external;
}

abstract contract NetIntegratedERC721A is ERC721A {
    using LibString for uint256;
    using LibString for address;

    INet public constant NET = INet(0x00000000B24D62781dB359b07880a105cD0b64e6);

    string internal constant TOPIC_MINT = "mint";
    string internal constant TOPIC_TRANSFER = "transfer";
    string internal constant TOPIC_BURN = "burn";
    string internal constant TOPIC_COLLECTION = "nft-collection";

    uint256 public immutable price;
    uint256 public immutable maxSupply;
    uint256 public immutable maxMintsPerWallet;
    uint256 public immutable creatorReserve;
    uint256 public creatorMinted;

    address internal immutable _deployer;
    mapping(uint256 => bytes32) internal _tokenToSeed;

    error IncorrectPayment();
    error MaxSupplyReached();
    error MaxMintsPerWalletReached();
    error CreatorReserveExceeded();
    error NotDeployer();

    modifier onlyDeployer() {
        if (msg.sender != _deployer) revert NotDeployer();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 price_,
        uint256 maxSupply_,
        uint256 maxMintsPerWallet_,
        uint256 creatorReserve_
    ) ERC721A(name_, symbol_) {
        _deployer = msg.sender;
        price = price_;
        maxSupply = maxSupply_;
        maxMintsPerWallet = maxMintsPerWallet_;
        creatorReserve = creatorReserve_;

        try NET.sendMessage(name_, TOPIC_COLLECTION, abi.encodePacked(tx.origin)) {} catch {}
    }

    function _startTokenId() internal pure virtual override returns (uint256) {
        return 1;
    }

    function mint(uint256 amount) external payable {
        if (msg.value != amount * price) revert IncorrectPayment();
        if (
            maxMintsPerWallet != 0 &&
            _numberMinted(msg.sender) + amount > maxMintsPerWallet
        ) revert MaxMintsPerWalletReached();

        _mintSeeded(msg.sender, amount);
    }

    function mintToCreator(uint256 amount, address to) external onlyDeployer {
        if (creatorMinted + amount > creatorReserve) revert CreatorReserveExceeded();
        creatorMinted += amount;
        _mintSeeded(to, amount);
    }

    function _mintSeeded(address to, uint256 amount) private {
        _enforceSupply(amount);
        _seed(_nextTokenId(), amount);
        _mint(to, amount);
    }

    function _enforceSupply(uint256 amount) internal view {
        if (maxSupply != 0 && _totalMinted() + amount > maxSupply) {
            revert MaxSupplyReached();
        }
    }

    function _seed(uint256 startTokenId, uint256 amount) internal virtual {
        unchecked {
            for (uint256 i; i < amount; ++i) {
                _tokenToSeed[startTokenId + i] =
                    keccak256(abi.encodePacked(block.prevrandao, startTokenId + i));
            }
        }
    }

    function withdraw() external {
        (bool ok, ) = _deployer.call{ value: address(this).balance }("");
        require(ok);
    }

    function _afterTokenTransfers(
        address from,
        address to,
        uint256 startTokenId,
        uint256 quantity
    ) internal virtual override {
        uint256 endTokenId = startTokenId + quantity - 1;

        address msgSender;
        string memory topic;
        string memory text;
        if (from == address(0)) {
            msgSender = to;
            topic = TOPIC_MINT;
            text = _mintText(to, startTokenId, endTokenId);
        } else if (to == address(0)) {
            msgSender = from;
            topic = TOPIC_BURN;
            text = _burnText(from, startTokenId, endTokenId);
        } else {
            msgSender = from;
            topic = TOPIC_TRANSFER;
            text = _transferText(from, to, startTokenId, endTokenId);
        }

        try NET.sendMessageViaApp(msgSender, text, topic, "") {} catch {}
    }

    function _mintText(address to, uint256 startId, uint256 endId)
        internal
        view
        virtual
        returns (string memory)
    {
        return string.concat(
            "Minted #", startId.toString(), "-#", endId.toString(),
            " to ", to.toHexString()
        );
    }

    function _transferText(address from, address to, uint256 startId, uint256 endId)
        internal
        view
        virtual
        returns (string memory)
    {
        return string.concat(
            "Transferred #", startId.toString(), "-#", endId.toString(),
            " from ", from.toHexString(), " to ", to.toHexString()
        );
    }

    function _burnText(address from, uint256 startId, uint256 endId)
        internal
        view
        virtual
        returns (string memory)
    {
        return string.concat(
            "Burned #", startId.toString(), "-#", endId.toString(),
            " by ", from.toHexString()
        );
    }
}
```

Save `src/TinyFrensNFT.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { NetIntegratedERC721A } from "./NetIntegratedERC721A.sol";
import { LibString } from "solady/utils/LibString.sol";
import { LibPRNG } from "solady/utils/LibPRNG.sol";
import { Base64 } from "solady/utils/Base64.sol";

/// @title TinyFrensNFT
/// @notice Curated 100% on-chain vector companion collection matching TinyFrens in-game floating pets.
///         Auto-posts mints and transfers to Net Protocol.
contract TinyFrensNFT is NetIntegratedERC721A {
    using LibString for uint256;
    using LibPRNG for LibPRNG.PRNG;

    struct Traits {
        uint8 species; // 0..7 (333 of each across 2664 total supply)
        uint8 palette; // 0..7 (Curated paired body, outline, bg)
        uint8 expr;    // 0..3 (Happy, Wink, Shades, Star Eyes)
        uint8 acc;     // 0..5 (None, Party Hat, Crown, Halo, Bow Tie, Mystic Orb)
    }

    constructor()
        NetIntegratedERC721A(
            "TinyFrens", // name
            "FREN",      // symbol
            0.001 ether, // price (0.001 ETH)
            2664,        // maxSupply (333 per species)
            20,          // maxMintsPerWallet
            20           // creatorReserve
        )
    {}

    function _traits(uint256 tokenId) internal view returns (Traits memory t) {
        LibPRNG.PRNG memory p;
        p.seed(uint256(_tokenToSeed[tokenId]));

        // Exactly 333 of each species across 2664 supply
        t.species = uint8((tokenId - 1) % 8);

        // Curated rarity distribution for palettes
        uint256 palRoll = p.uniform(100);
        if (palRoll < 5) {
            t.palette = 7; // 24K Solid Gold (Legendary)
        } else if (palRoll < 20) {
            t.palette = 6; // Midnight Obsidian (Rare)
        } else {
            t.palette = uint8(p.uniform(6)); // Classic colorways
        }

        t.expr = uint8(p.uniform(4));
        t.acc = uint8(p.uniform(6));
    }

    function _speciesName(uint8 s) internal pure returns (string memory) {
        if (s == 0) return "Cat";
        if (s == 1) return "Blob";
        if (s == 2) return "Robot";
        if (s == 3) return "Bunny";
        if (s == 4) return "Puppy";
        if (s == 5) return "Bear";
        if (s == 6) return "Frog";
        return "Turtle";
    }

    function _paletteData(uint8 p) internal pure returns (
        string memory body,
        string memory dark,
        string memory bg,
        string memory name,
        string memory tier
    ) {
        if (p == 0) return ("#a474f1", "#4b2d77", "#17142a", "Lavender Dream", "Classic");
        if (p == 1) return ("#66c7d2", "#235960", "#0d1117", "Cyber Neon", "Classic");
        if (p == 2) return ("#ffb95e", "#7a4e12", "#fff7ed", "Sunny Amber", "Classic");
        if (p == 3) return ("#82eba1", "#235f37", "#e8f5e9", "Mint Meadow", "Classic");
        if (p == 4) return ("#ff82a7", "#6f233a", "#fdf2f8", "Bubblegum", "Classic");
        if (p == 5) return ("#4d96ff", "#1b3f75", "#f0f9ff", "Electric Blue", "Classic");
        if (p == 6) return ("#3a2d52", "#1e162d", "#211c39", "Midnight Obsidian", "Rare");
        return ("#ffd700", "#b7791f", "#2d132c", "24K Solid Gold", "Legendary");
    }

    function _exprName(uint8 e) internal pure returns (string memory) {
        if (e == 0) return "Classic Happy";
        if (e == 1) return "Playful Wink";
        if (e == 2) return "Cool Shades";
        return "Star Eyes";
    }

    function _accName(uint8 a) internal pure returns (string memory) {
        if (a == 0) return "None";
        if (a == 1) return "Party Hat";
        if (a == 2) return "Royal Crown";
        if (a == 3) return "Angel Halo";
        if (a == 4) return "Dapper Bow Tie";
        return "Mystic Orb";
    }

    /// @notice Pixel & Vector twin of in-game floating companion (128x148)
    function art(uint256 tokenId) public view returns (string memory) {
        Traits memory t = _traits(tokenId);
        (string memory body, string memory dark, string memory bg, , ) = _paletteData(t.palette);

        string memory earsSvg = "";
        string memory bodyRadius = 'rx="38" ry="32"';
        string memory shellSvg = "";

        if (t.species == 0) { // Cat
            earsSvg = string.concat(
                '<polygon points="20,40 36,4 52,40" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<polygon points="76,40 92,4 108,40" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>'
            );
        } else if (t.species == 1) { // Blob
            bodyRadius = 'rx="48" ry="40"';
        } else if (t.species == 2) { // Robot
            earsSvg = string.concat(
                '<rect x="60" y="8" width="8" height="24" fill="', dark, '"/>',
                '<circle cx="64" cy="8" r="6" fill="', body, '" stroke="', dark, '" stroke-width="3"/>'
            );
            bodyRadius = 'rx="8" ry="8"';
        } else if (t.species == 3) { // Bunny
            earsSvg = string.concat(
                '<rect x="26" y="2" width="20" height="50" rx="10" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<rect x="82" y="2" width="20" height="50" rx="10" fill="', body, '" stroke="', dark, '" stroke-width="7"/>'
            );
        } else if (t.species == 4) { // Puppy
            earsSvg = string.concat(
                '<rect x="6" y="38" width="24" height="42" rx="10" transform="rotate(-25 6 38)" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<rect x="98" y="28" width="24" height="42" rx="10" transform="rotate(25 98 28)" fill="', body, '" stroke="', dark, '" stroke-width="7"/>'
            );
        } else if (t.species == 5) { // Bear
            earsSvg = string.concat(
                '<circle cx="28" cy="30" r="16" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<circle cx="100" cy="30" r="16" fill="', body, '" stroke="', dark, '" stroke-width="7"/>'
            );
        } else if (t.species == 6) { // Frog
            earsSvg = string.concat(
                '<circle cx="34" cy="32" r="16" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<circle cx="94" cy="32" r="16" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<circle cx="34" cy="32" r="5" fill="#fff"/>',
                '<circle cx="94" cy="32" r="5" fill="#fff"/>',
                '<circle cx="34" cy="32" r="2.5" fill="', dark, '"/>',
                '<circle cx="94" cy="32" r="2.5" fill="', dark, '"/>'
            );
            bodyRadius = 'rx="46" ry="38"';
        } else { // Turtle
            bodyRadius = 'rx="48" ry="40"';
            shellSvg = string.concat('<circle cx="64" cy="83" r="30" fill="none" stroke="', dark, '" stroke-width="4" stroke-dasharray="8 6"/>');
        }

        string memory eyesSvg = "";
        if (t.expr == 0) { // Happy
            eyesSvg = string.concat(
                '<rect x="32" y="66" width="12" height="20" rx="3" fill="', dark, '"/>',
                '<rect x="84" y="66" width="12" height="20" rx="3" fill="', dark, '"/>',
                '<circle cx="35" cy="70" r="2.5" fill="#fff"/>',
                '<circle cx="87" cy="70" r="2.5" fill="#fff"/>'
            );
        } else if (t.expr == 1) { // Wink
            eyesSvg = string.concat(
                '<rect x="32" y="66" width="12" height="20" rx="3" fill="', dark, '"/>',
                '<circle cx="35" cy="70" r="2.5" fill="#fff"/>',
                '<path d="M 82 76 Q 90 70 98 76" stroke="', dark, '" stroke-width="4" fill="none" stroke-linecap="round"/>'
            );
        } else if (t.expr == 2) { // Shades
            eyesSvg = string.concat(
                '<rect x="24" y="64" width="36" height="18" rx="3" fill="#111"/>',
                '<rect x="68" y="64" width="36" height="18" rx="3" fill="#111"/>',
                '<rect x="56" y="68" width="16" height="4" fill="#111"/>',
                '<line x1="28" y1="67" x2="52" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>',
                '<line x1="72" y1="67" x2="96" y2="78" stroke="#fff" stroke-width="2" opacity="0.6"/>'
            );
        } else { // Star Eyes
            eyesSvg = '<polygon points="38,62 41,71 50,71 43,76 46,85 38,80 30,85 33,76 26,71 35,71" fill="#ffd700"/><polygon points="90,62 93,71 102,71 95,76 98,85 90,80 82,85 85,76 78,71 87,71" fill="#ffd700"/>';
        }

        string memory accSvg = "";
        if (t.acc == 1) { // Party hat
            accSvg = '<polygon points="64,4 48,32 80,32" fill="#ff4757" stroke="#ffd700" stroke-width="3"/><circle cx="64" cy="4" r="5" fill="#ffd700"/>';
        } else if (t.acc == 2) { // Crown
            accSvg = '<polygon points="46,26 46,14 55,20 64,10 73,20 82,14 82,26" fill="#ffd700" stroke="#b7791f" stroke-width="2"/><circle cx="64" cy="10" r="3" fill="#e74c3c"/>';
        } else if (t.acc == 3) { // Halo
            accSvg = '<ellipse cx="64" cy="12" rx="30" ry="8" fill="none" stroke="#ffeaa7" stroke-width="5"/>';
        } else if (t.acc == 4) { // Bow tie
            accSvg = '<polygon points="56,116 64,120 56,124" fill="#e74c3c"/><polygon points="72,116 64,120 72,124" fill="#e74c3c"/><circle cx="64" cy="120" r="3" fill="#c0392b"/>';
        } else if (t.acc == 5) { // Mystic orb
            accSvg = '<circle cx="114" cy="100" r="12" fill="#00d2d3" opacity="0.85"/><circle cx="111" cy="97" r="4" fill="#fff" opacity="0.9"/>';
        }

        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="100%" height="100%">',
            '<rect width="128" height="148" fill="', bg, '"/>',
            '<rect x="25" y="132" width="29" height="12" rx="4" fill="', dark, '"/>',
            '<rect x="74" y="132" width="29" height="12" rx="4" fill="', dark, '"/>',
            earsSvg,
            '<rect x="9" y="31" width="110" height="105" ', bodyRadius, ' fill="', body, '" stroke="', dark, '" stroke-width="8"/>',
            shellSvg,
            '<rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>',
            '<rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>',
            eyesSvg,
            '<rect x="60" y="96" width="8" height="5" rx="2" fill="', dark, '"/>',
            accSvg,
            '</svg>'
        );
    }

    function _attributes(uint256 tokenId) internal view returns (string memory) {
        Traits memory t = _traits(tokenId);
        (, , , string memory palName, string memory tier) = _paletteData(t.palette);

        return string.concat(
            '[{"trait_type":"Species","value":"', _speciesName(t.species),
            '"},{"trait_type":"Palette","value":"', palName,
            '"},{"trait_type":"Rarity Tier","value":"', tier,
            '"},{"trait_type":"Expression","value":"', _exprName(t.expr),
            '"},{"trait_type":"Accessory","value":"', _accName(t.acc),
            '"}]'
        );
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();

        string memory image = Base64.encode(bytes(art(tokenId)));
        string memory json = string.concat(
            '{"name":"TinyFren #', tokenId.toString(),
            '","description":"TinyFrens 1:1 on-chain companion. A little company. A little chaos. Your tiny fren.",',
            '"image":"data:image/svg+xml;base64,', image, '",',
            '"attributes":', _attributes(tokenId),
            '}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
```

### Step 3: Compile and Test

```bash
forge build
```

### Step 4: Deploy and Verify

**Deploy to Robinhood Chain (4663):**
```bash
forge create src/TinyFrensNFT.sol:TinyFrensNFT \
  --rpc-url https://rpc.robinhood.com \
  --private-key $PRIVATE_KEY \
  --verify
```

**Or Deploy to Base Mainnet (8453):**
```bash
forge create src/TinyFrensNFT.sol:TinyFrensNFT \
  --rpc-url https://mainnet.base.org \
  --private-key $PRIVATE_KEY \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY
```

### Step 5: Premint Creator Reserve & Announce on Net Protocol

```bash
# Premint 20 creator tokens (free of charge, within creatorReserve)
cast send $NFT_ADDRESS "mintToCreator(uint256,address)" 20 $CREATOR_ADDRESS --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# Announce on the collection's Net Protocol feed:
netp message send --text "TinyFrens is officially live! 8 companion species, 2664 curated 1:1 on-chain frens. Minting now." --topic "feed-$(echo $NFT_ADDRESS | tr '[:upper:]' '[:lower:]')" --chain-id $CHAIN_ID
```
