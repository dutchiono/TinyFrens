---
name: tinyfrens-nft
description: Deploy and verify the TinyFrens on-chain generative NFT collection on Robinhood Chain (4663) or Base (8453) with 8 companion species, 64,000 permutations, and Net Protocol integration.
metadata: {"bankr":{"emoji":"🐾","requires":{"bins":["forge","cast"]}}}
---

# TinyFrens NFT Collection Skill

**TinyFrens** is a generative, 100% on-chain NFT companion collection. Each Fren is rendered directly in SVG with fully on-chain metadata attributes, auto-posting every mint, transfer, and burn event to **Net Protocol**.

---

## 1. Collection Specifications

| Parameter | Value |
|---|---|
| **Collection Name** | `TinyFrens` |
| **Token Symbol** | `FREN` |
| **Max Supply** | `3333` |
| **Mint Price** | `0.001 ETH` |
| **Max Mints Per Wallet** | `20` |
| **Creator Reserve** | `20` |
| **Art Type** | Fully On-Chain SVG (No IPFS/HTTP dependency) |
| **Species (8)** | Cat, Blob, Robot, Bunny, Puppy, Bear, Frog, Turtle |
| **Permutations** | 64,000 unique trait combinations (8 shapes × 10 palettes × 10 backgrounds × 8 expressions × 10 accessories) |
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

contract TinyFrensNFT is NetIntegratedERC721A {
    using LibString for uint256;
    using LibPRNG for LibPRNG.PRNG;

    struct Traits {
        uint8 shape;      // 0..7
        uint8 color;      // 0..9
        uint8 bg;         // 0..9
        uint8 expr;       // 0..7
        uint8 acc;        // 0..9
    }

    constructor()
        NetIntegratedERC721A(
            "TinyFrens",
            "FREN",
            0.001 ether,
            3333,
            20,
            20
        )
    {}

    function _traits(uint256 tokenId) internal view returns (Traits memory t) {
        LibPRNG.PRNG memory p;
        p.seed(uint256(_tokenToSeed[tokenId]));
        t.shape = uint8(p.uniform(8));
        t.color = uint8(p.uniform(10));
        t.bg    = uint8(p.uniform(10));
        t.expr  = uint8(p.uniform(8));
        t.acc   = uint8(p.uniform(10));
    }

    function _shapeName(uint8 s) internal pure returns (string memory) {
        if (s == 0) return "Cat";
        if (s == 1) return "Blob";
        if (s == 2) return "Robot";
        if (s == 3) return "Bunny";
        if (s == 4) return "Puppy";
        if (s == 5) return "Bear";
        if (s == 6) return "Frog";
        return "Turtle";
    }

    function _colorHex(uint8 c) internal pure returns (string memory hexColor, string memory outline, string memory name) {
        if (c == 0) return ("#a474f1", "#4b2d77", "Lavender");
        if (c == 1) return ("#66c7d2", "#235960", "Cyber Cyan");
        if (c == 2) return ("#ffb95e", "#7a4e12", "Sunny Amber");
        if (c == 3) return ("#82eba1", "#235f37", "Mint Glow");
        if (c == 4) return ("#ff82a7", "#6f233a", "Bubblegum Pink");
        if (c == 5) return ("#4d96ff", "#1b3f75", "Electric Blue");
        if (c == 6) return ("#2ecc71", "#145a32", "Neon Emerald");
        if (c == 7) return ("#ff7675", "#7b2625", "Sunset Coral");
        if (c == 8) return ("#8854d0", "#3d1c68", "Phantom Purple");
        return ("#2d3436", "#111415", "Obsidian Midnight");
    }

    function _bgData(uint8 b) internal pure returns (string memory fill, string memory name) {
        if (b == 0) return ("#17142a", "Deep Void");
        if (b == 1) return ("#211c39", "Retro Grid");
        if (b == 2) return ("#e8f5e9", "Pastel Meadow");
        if (b == 3) return ("#fab1a0", "Sunset Horizon");
        if (b == 4) return ("#0c1021", "Starry Abyss");
        if (b == 5) return ("#2d132c", "Royal Velvet");
        if (b == 6) return ("#dff9fb", "Mint Tea");
        if (b == 7) return ("#ffecd2", "Warm Sunrise");
        if (b == 8) return ("#ffd1ff", "Bubblegum Dream");
        return ("#0d1117", "Terminal Green");
    }

    function _exprName(uint8 e) internal pure returns (string memory) {
        if (e == 0) return "Joyful";
        if (e == 1) return "Wink";
        if (e == 2) return "Cool Shades";
        if (e == 3) return "Star Eyes";
        if (e == 4) return "Sleepy zZ";
        if (e == 5) return "Loving Blush";
        if (e == 6) return "Laser Eyes";
        return "Cheerful Grin";
    }

    function _accName(uint8 a) internal pure returns (string memory) {
        if (a == 0) return "None";
        if (a == 1) return "Party Hat";
        if (a == 2) return "Royal Crown";
        if (a == 3) return "Straw Hat";
        if (a == 4) return "Angel Halo";
        if (a == 5) return "Winter Beanie";
        if (a == 6) return "Strawberry Snack";
        if (a == 7) return "Mystic Orb";
        if (a == 8) return "Bubble Shield";
        return "Bow Tie";
    }

    function art(uint256 tokenId) public view returns (string memory) {
        Traits memory t = _traits(tokenId);
        (string memory hexCol, string memory outline, ) = _colorHex(t.color);
        (string memory bgFill, ) = _bgData(t.bg);

        string memory earsSvg = "";
        if (t.shape == 0) {
            earsSvg = string.concat(
                '<polygon points="105,95 125,50 145,95" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>',
                '<polygon points="175,95 195,50 215,95" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>'
            );
        } else if (t.shape == 2) {
            earsSvg = string.concat(
                '<rect x="156" y="52" width="8" height="25" fill="', outline, '"/>',
                '<circle cx="160" cy="48" r="8" fill="', hexCol, '" stroke="', outline, '" stroke-width="4"/>'
            );
        } else if (t.shape == 3) {
            earsSvg = string.concat(
                '<rect x="115" y="28" width="24" height="75" rx="12" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>',
                '<rect x="181" y="28" width="24" height="75" rx="12" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>'
            );
        } else if (t.shape == 4) {
            earsSvg = string.concat(
                '<rect x="85" y="100" width="32" height="60" rx="16" transform="rotate(-30 85 100)" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>',
                '<rect x="205" y="85" width="32" height="60" rx="16" transform="rotate(30 205 85)" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>'
            );
        } else if (t.shape == 5) {
            earsSvg = string.concat(
                '<circle cx="112" cy="95" r="22" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>',
                '<circle cx="208" cy="95" r="22" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>'
            );
        } else if (t.shape == 6) {
            earsSvg = string.concat(
                '<circle cx="120" cy="95" r="22" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>',
                '<circle cx="200" cy="95" r="22" fill="', hexCol, '" stroke="', outline, '" stroke-width="8"/>',
                '<circle cx="120" cy="95" r="6" fill="#fff"/>',
                '<circle cx="200" cy="95" r="6" fill="#fff"/>'
            );
        }

        string memory eyesSvg = string.concat(
            '<rect x="126" y="132" width="14" height="22" rx="4" fill="', outline, '"/>',
            '<rect x="180" y="132" width="14" height="22" rx="4" fill="', outline, '"/>',
            '<circle cx="130" cy="138" r="3" fill="#fff"/>',
            '<circle cx="184" cy="138" r="3" fill="#fff"/>'
        );

        if (t.expr == 1) {
            eyesSvg = string.concat(
                '<rect x="126" y="132" width="14" height="22" rx="4" fill="', outline, '"/>',
                '<path d="M 178 144 Q 188 136 198 144" stroke="', outline, '" stroke-width="5" fill="none" stroke-linecap="round"/>'
            );
        } else if (t.expr == 2) {
            eyesSvg = '<polygon points="115,130 150,130 145,152 120,152" fill="#111"/><polygon points="170,130 205,130 200,152 175,152" fill="#111"/><line x1="150" y1="135" x2="170" y2="135" stroke="#111" stroke-width="4"/>';
        } else if (t.expr == 4) {
            eyesSvg = string.concat(
                '<line x1="124" y1="142" x2="142" y2="142" stroke="', outline, '" stroke-width="5" stroke-linecap="round"/>',
                '<line x1="178" y1="142" x2="196" y2="142" stroke="', outline, '" stroke-width="5" stroke-linecap="round"/>',
                '<text x="215" y="115" font-family="sans-serif" font-weight="bold" font-size="20" fill="#9c88ff">zZ</text>'
            );
        }

        string memory accSvg = "";
        if (t.acc == 1) {
            accSvg = '<polygon points="160,35 140,85 180,85" fill="#ff4757" stroke="#ffd700" stroke-width="3"/><circle cx="160" cy="32" r="6" fill="#ffd700"/>';
        } else if (t.acc == 2) {
            accSvg = '<polygon points="140,75 140,60 150,68 160,56 170,68 180,60 180,75" fill="#ffd700" stroke="#b7791f" stroke-width="2"/>';
        } else if (t.acc == 4) {
            accSvg = '<ellipse cx="160" cy="55" rx="36" ry="10" fill="none" stroke="#ffeaa7" stroke-width="6"/>';
        } else if (t.acc == 9) {
            accSvg = '<polygon points="150,195 160,200 150,205" fill="#e74c3c"/><polygon points="170,195 160,200 170,205" fill="#e74c3c"/>';
        }

        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="100%" height="100%">',
            '<rect width="100%" height="100%" fill="', bgFill, '"/>',
            '<rect x="120" y="240" width="30" height="15" rx="6" fill="', outline, '"/>',
            '<rect x="170" y="240" width="30" height="15" rx="6" fill="', outline, '"/>',
            earsSvg,
            '<rect x="100" y="85" width="120" height="150" rx="42" fill="', hexCol, '" stroke="', outline, '" stroke-width="10"/>',
            '<rect x="110" y="165" width="16" height="8" rx="4" fill="#ff82a7"/>',
            '<rect x="194" y="165" width="16" height="8" rx="4" fill="#ff82a7"/>',
            eyesSvg,
            '<rect x="156" y="175" width="8" height="6" rx="2" fill="', outline, '"/>',
            accSvg,
            '</svg>'
        );
    }

    function _attributes(uint256 tokenId) internal view returns (string memory) {
        Traits memory t = _traits(tokenId);
        (, , string memory colName) = _colorHex(t.color);
        (, string memory bgName) = _bgData(t.bg);

        return string.concat(
            '[{"trait_type":"Shape","value":"', _shapeName(t.shape),
            '"},{"trait_type":"Color","value":"', colName,
            '"},{"trait_type":"Background","value":"', bgName,
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
            '","description":"TinyFrens on-chain generative collection. A little company. A little chaos. Your tiny fren.",',
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
netp message send --text "TinyFrens is officially live! 8 companion species, 64,000 permutations. Minting now." --topic "feed-$(echo $NFT_ADDRESS | tr '[:upper:]' '[:lower:]')" --chain-id $CHAIN_ID
```
