// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { NetIntegratedERC721A } from "./NetIntegratedERC721A.sol";
import { LibString } from "solady/utils/LibString.sol";
import { LibPRNG } from "solady/utils/LibPRNG.sol";
import { Base64 } from "solady/utils/Base64.sol";
import { ITinyFrensArt, TinyFrensArt, Traits } from "./TinyFrensArt.sol";

interface INetStorage {
    function put(bytes32 key, string calldata text, bytes calldata data) external;
    function get(bytes32 key, address operator) external view returns (string memory, bytes memory);
}

/// @title TinyFrensNFT
/// @notice Curated 100% on-chain vector companion collection matching TinyFrens in-game floating pets.
///         Auto-posts mints and transfers to Net Protocol.
contract TinyFrensNFT is NetIntegratedERC721A {
    using LibString for uint256;
    using LibPRNG for LibPRNG.PRNG;

    ITinyFrensArt public immutable artRenderer;

    mapping(uint256 => string) private _customName;
    mapping(uint256 => uint8) private _evolution;

    INetStorage public constant NET_STORAGE = INetStorage(0x00000000DB40fcB9f4466330982372e27Fd7Bbf5);

    event TinyFrenRenamed(uint256 indexed tokenId, string name);
    event TinyFrenEvolved(uint256 indexed tokenId, uint8 stage);
    event TinyFrenNetStorageSynced(uint256 indexed tokenId, address indexed operator, bytes32 indexed key);

    error InvalidPetName();
    error MaxEvolutionReached();
    error NotTokenOwner();

    constructor()
        NetIntegratedERC721A(
            "TinyFrens", // name
            "FREN",      // symbol
            0.001 ether, // price (0.001 ETH)
            2664,        // maxSupply (333 per species)
            20,          // maxMintsPerWallet
            20           // creatorReserve
        )
    {
        artRenderer = new TinyFrensArt();
    }

    function tokenName(uint256 tokenId) public view returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        string memory custom = _customName[tokenId];
        if (bytes(custom).length != 0) return custom;
        return string.concat("TinyFren #", tokenId.toString());
    }

    function evolutionStage(uint256 tokenId) public view returns (uint8) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        return _evolution[tokenId];
    }

    function rename(uint256 tokenId, string calldata newName) external {
        _requireTokenOwner(tokenId);
        bytes calldata raw = bytes(newName);
        if (raw.length == 0 || raw.length > 32) revert InvalidPetName();
        for (uint256 i; i < raw.length; ++i) {
            bytes1 c = raw[i];
            bool ok = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)
                || c == 0x20 || c == 0x21 || c == 0x23 || c == 0x2D || c == 0x2E || c == 0x3F || c == 0x5F;
            if (!ok) revert InvalidPetName();
        }
        _customName[tokenId] = newName;
        _syncNetStorage(tokenId);
        emit TinyFrenRenamed(tokenId, newName);
    }

    function evolve(uint256 tokenId) external {
        _requireTokenOwner(tokenId);
        uint8 stage = _evolution[tokenId];
        if (stage >= 3) revert MaxEvolutionReached();
        unchecked {
            stage += 1;
        }
        _evolution[tokenId] = stage;
        _syncNetStorage(tokenId);
        emit TinyFrenEvolved(tokenId, stage);
    }

    function netStoragePointer(uint256 tokenId)
        external
        view
        returns (address operator, bytes32 key, string memory text)
    {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        return (address(this), _netStorageKey(tokenId), _netStorageText(tokenId));
    }

    function _requireTokenOwner(uint256 tokenId) internal view {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
    }

    function _afterMintSeeded(uint256 startTokenId, uint256 amount) internal override {
        if (address(NET_STORAGE).code.length == 0) return;
        unchecked {
            for (uint256 i; i < amount; ++i) {
                _syncNetStorage(startTokenId + i);
            }
        }
    }

    function _netStorageKey(uint256 tokenId) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("tinyfrens.tokenURI", address(this), tokenId));
    }

    function _netStorageText(uint256 tokenId) internal pure returns (string memory) {
        return string.concat("TinyFrens tokenURI #", tokenId.toString());
    }

    function _syncNetStorage(uint256 tokenId) internal {
        if (address(NET_STORAGE).code.length == 0) return;
        bytes32 key = _netStorageKey(tokenId);
        NET_STORAGE.put(key, _netStorageText(tokenId), bytes(_generatedTokenURI(tokenId)));
        emit TinyFrenNetStorageSynced(tokenId, address(this), key);
    }

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
        t.era = uint8((tokenId - 1) / 888);
        t.habitat = uint8(p.uniform(6));
        t.motion = uint8(p.uniform(4));
    }

    function _speciesName(uint8 s) internal pure returns (string memory) {
        if (s == 0) return "Cat";
        if (s == 1) return "Blob";
        if (s == 2) return "Robot";
        if (s == 3) return "Bunny";
        if (s == 4) return "Duck";
        if (s == 5) return "Pig";
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

    function _eraName(uint8 e) internal pure returns (string memory) {
        if (e == 0) return "Pocket Genesis";
        if (e == 1) return "Street Wanderers";
        return "Dream Garden";
    }

    function _habitatName(uint8 h) internal pure returns (string memory) {
        if (h == 0) return "Moonlit Plaza";
        if (h == 1) return "Neon Crosswalk";
        if (h == 2) return "Snack Garden";
        if (h == 3) return "Cloud Room";
        if (h == 4) return "Arcade Alley";
        return "Tiny Meadow";
    }

    function _motionName(uint8 m) internal pure returns (string memory) {
        if (m == 0) return "Happy Walk";
        if (m == 1) return "Bouncy Strut";
        if (m == 2) return "Sleepy Drift";
        return "Excited Wiggle";
    }

    /// @notice Pixel & Vector twin of in-game floating companion (128x148)
    function art(uint256 tokenId) public view returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        return artRenderer.render(_traits(tokenId), _evolution[tokenId]);
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
            '"},{"trait_type":"Era","value":"', _eraName(t.era),
            '"},{"trait_type":"Habitat","value":"', _habitatName(t.habitat),
            '"},{"trait_type":"Motion","value":"', _motionName(t.motion),
            '"},{"trait_type":"Evolution","value":"Stage ', uint256(_evolution[tokenId]).toString(),
            '"}]'
        );
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();

        if (address(NET_STORAGE).code.length > 0) {
            try NET_STORAGE.get(_netStorageKey(tokenId), address(this)) returns (string memory, bytes memory data) {
                if (data.length != 0) return string(data);
            } catch {}
        }

        return _generatedTokenURI(tokenId);
    }

    function _generatedTokenURI(uint256 tokenId) internal view returns (string memory) {
        string memory image = Base64.encode(bytes(art(tokenId)));
        string memory json = string.concat(
            '{"name":"', tokenName(tokenId),
            '","description":"TinyFrens 1:1 on-chain companion. A little company. A little chaos. Your tiny fren.",',
            '"image":"data:image/svg+xml;base64,', image, '",',
            '"attributes":', _attributes(tokenId),
            '}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
