// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { NetIntegratedERC721A } from "./NetIntegratedERC721A.sol";
import { LibString } from "solady/utils/LibString.sol";
import { LibPRNG } from "solady/utils/LibPRNG.sol";
import { Base64 } from "solady/utils/Base64.sol";

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

    struct Traits {
        uint8 species; // 0..7 (333 of each across 2664 total supply)
        uint8 palette; // 0..7 (Curated paired body, outline, bg)
        uint8 expr;    // 0..3 (Happy, Wink, Shades, Star Eyes)
        uint8 acc;     // 0..5 (None, Party Hat, Crown, Halo, Bow Tie, Mystic Orb)
        uint8 era;     // 0..2 (three 888-token cohorts)
        uint8 habitat; // 0..5 (scene/background layer)
        uint8 motion;  // 0..3 (animation personality)
    }

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
    {}

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
        Traits memory t = _traits(tokenId);
        (string memory body, string memory dark, string memory bg, , ) = _paletteData(t.palette);

        string memory earsSvg = "";
        string memory shellSvg = "";
        string memory speciesSvg = "";
        string memory limbsSvg = "";
        string memory shineSvg = "";
        string memory habitatSvg = "";
        string memory motionValues = "0 0;0 -3;0 0";
        string memory motionDur = "1.4s";

        if (t.habitat == 0) {
            habitatSvg = '<circle cx="18" cy="22" r="3" fill="#fff" opacity=".7"/><circle cx="102" cy="31" r="2" fill="#fff" opacity=".55"/><path d="M12 126 H116" stroke="#fff" stroke-width="2" opacity=".12"/>';
        } else if (t.habitat == 1) {
            habitatSvg = '<path d="M0 120 H128" stroke="#00d2d3" stroke-width="4" opacity=".32"/><path d="M8 132 H38 M54 132 H84 M100 132 H126" stroke="#fff" stroke-width="4" opacity=".22"/><circle cx="108" cy="22" r="7" fill="#ff82a7" opacity=".5"/>';
        } else if (t.habitat == 2) {
            habitatSvg = '<path d="M0 124 C22 114 42 134 64 122 C86 110 104 128 128 116 V148 H0 Z" fill="#82eba1" opacity=".28"/><circle cx="18" cy="110" r="3" fill="#ff4757"/><circle cx="104" cy="118" r="3" fill="#ff4757"/>';
        } else if (t.habitat == 3) {
            habitatSvg = '<ellipse cx="30" cy="28" rx="18" ry="7" fill="#fff" opacity=".22"/><ellipse cx="92" cy="42" rx="22" ry="8" fill="#fff" opacity=".18"/><path d="M0 130 C20 124 42 128 64 123 C86 118 108 124 128 119 V148 H0 Z" fill="#fff" opacity=".12"/>';
        } else if (t.habitat == 4) {
            habitatSvg = '<rect x="8" y="16" width="18" height="18" rx="4" fill="#ffd700" opacity=".32"/><rect x="102" y="20" width="14" height="30" rx="4" fill="#66c7d2" opacity=".28"/><path d="M8 128 H120" stroke="#ffd700" stroke-width="3" stroke-dasharray="8 7" opacity=".32"/>';
        } else {
            habitatSvg = '<path d="M0 126 Q32 112 64 124 T128 122 V148 H0 Z" fill="#82eba1" opacity=".24"/><circle cx="24" cy="112" r="4" fill="#ffd700" opacity=".7"/><circle cx="112" cy="108" r="3" fill="#ffd700" opacity=".65"/>';
        }

        if (t.motion == 1) {
            motionValues = "0 0;0 -7;0 0";
            motionDur = "0.8s";
        } else if (t.motion == 2) {
            motionValues = "0 0;1 -2;0 0";
            motionDur = "2.4s";
        } else if (t.motion == 3) {
            motionValues = "0 0;-2 -4;2 -4;0 0";
            motionDur = "0.9s";
        }

        if (t.species == 0) { // Cat
            earsSvg = string.concat(
                '<path d="M18 45 L34 6 L54 43 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M74 43 L94 6 L110 45 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M29 34 L36 17 L45 35 Z M83 35 L92 17 L99 34 Z" fill="#ffb6c8" opacity=".78"/>',
                '<path d="M102 105 C132 98 130 64 103 75 C122 79 121 99 102 97" fill="none" stroke="', dark, '" stroke-width="8" stroke-linecap="round"/>'
            );
            limbsSvg = string.concat(
                '<path d="M30 119 C21 126 19 137 35 137 H49 C47 126 39 120 30 119 Z" fill="', dark, '"/>',
                '<path d="M79 119 C88 120 97 126 99 137 H82 C72 137 72 126 79 119 Z" fill="', dark, '"/>'
            );
            speciesSvg = string.concat(
                '<path d="M21 88 H5 M22 96 H7 M107 88 H123 M106 96 H121" stroke="', dark, '" stroke-width="3" stroke-linecap="round"/>',
                '<path d="M58 94 Q64 99 70 94" stroke="', dark, '" stroke-width="3" fill="none" stroke-linecap="round"/>'
            );
            shineSvg = '<ellipse cx="43" cy="55" rx="16" ry="13" fill="url(#shine)"/>';
        } else if (t.species == 1) { // Blob
            limbsSvg = string.concat(
                '<path d="M28 124 C20 131 27 140 39 134" fill="', dark, '" opacity=".58"/>',
                '<path d="M88 126 C99 132 97 141 83 136" fill="', dark, '" opacity=".58"/>'
            );
            shellSvg = string.concat(
                '<path d="M31 58 C19 75 19 112 40 125 C53 134 57 120 68 126 C90 136 111 116 108 86 C105 56 89 45 70 52 C54 40 39 43 31 58 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>',
                '<path d="M38 55 C47 47 56 47 65 55" stroke="#fff" stroke-width="4" opacity=".22" fill="none" stroke-linecap="round"/>'
            );
            speciesSvg = string.concat('<path d="M30 101 C45 93 50 114 64 104 C79 94 87 112 101 101" stroke="', dark, '" stroke-width="3" opacity=".36" fill="none" stroke-linecap="round"/>');
            shineSvg = '<ellipse cx="47" cy="62" rx="19" ry="16" fill="url(#shine)"/>';
        } else if (t.species == 2) { // Robot
            earsSvg = string.concat(
                '<path d="M64 30 V11" stroke="', dark, '" stroke-width="7" stroke-linecap="round"/>',
                '<circle cx="64" cy="8" r="6" fill="', body, '" stroke="', dark, '" stroke-width="3"/>',
                '<circle cx="64" cy="8" r="2" fill="#fff"/>'
            );
            limbsSvg = string.concat(
                '<path d="M22 84 H11 V105 H22" fill="none" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M106 84 H117 V105 H106" fill="none" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M31 129 H50 M78 129 H97" stroke="', dark, '" stroke-width="9" stroke-linecap="round"/>'
            );
            speciesSvg = string.concat(
                '<path d="M36 59 H92 M40 106 H88" stroke="', dark, '" stroke-width="3" opacity=".45"/>',
                '<circle cx="45" cy="108" r="3" fill="', dark, '" opacity=".55"/><circle cx="83" cy="108" r="3" fill="', dark, '" opacity=".55"/>'
            );
            shineSvg = '<rect x="39" y="44" width="15" height="10" rx="3" fill="#fff" opacity=".2"/>';
        } else if (t.species == 3) { // Bunny
            earsSvg = string.concat(
                '<path d="M34 58 C22 38 22 11 36 4 C52 8 52 40 43 61 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M94 58 C106 38 106 11 92 4 C76 8 76 40 85 61 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M37 47 C32 33 33 19 38 13 M91 47 C96 33 95 19 90 13" stroke="#ffb6c8" stroke-width="5" stroke-linecap="round" opacity=".72"/>'
            );
            limbsSvg = string.concat('<ellipse cx="42" cy="132" rx="18" ry="8" fill="', dark, '"/><ellipse cx="86" cy="132" rx="18" ry="8" fill="', dark, '"/>');
            speciesSvg = '<rect x="58" y="101" width="5" height="10" rx="1" fill="#fff"/><rect x="65" y="101" width="5" height="10" rx="1" fill="#fff"/><circle cx="103" cy="104" r="8" fill="#fff" opacity=".55"/>';
            shineSvg = '<ellipse cx="47" cy="62" rx="15" ry="14" fill="url(#shine)"/>';
        } else if (t.species == 4) { // Puppy
            earsSvg = string.concat(
                '<path d="M26 48 C7 42 4 63 20 82 C33 78 37 61 26 48 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M102 48 C121 42 124 63 108 82 C95 78 91 61 102 48 Z" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<path d="M103 111 C119 116 123 101 112 94" fill="none" stroke="', dark, '" stroke-width="8" stroke-linecap="round"/>'
            );
            limbsSvg = string.concat(
                '<path d="M29 124 C22 132 29 139 43 135" fill="', dark, '"/>',
                '<path d="M85 124 C98 126 103 134 94 139 H80 C78 133 80 128 85 124 Z" fill="', dark, '"/>'
            );
            speciesSvg = string.concat('<ellipse cx="64" cy="98" rx="21" ry="15" fill="#fff" opacity="0.35"/><circle cx="64" cy="94" r="5" fill="', dark, '"/>');
            shineSvg = '<ellipse cx="43" cy="59" rx="15" ry="13" fill="url(#shine)"/>';
        } else if (t.species == 5) { // Bear
            earsSvg = string.concat(
                '<circle cx="28" cy="35" r="17" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<circle cx="100" cy="35" r="17" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<circle cx="28" cy="35" r="8" fill="#ffb6c8" opacity=".6"/>',
                '<circle cx="100" cy="35" r="8" fill="#ffb6c8" opacity=".6"/>'
            );
            limbsSvg = string.concat(
                '<circle cx="35" cy="119" r="10" fill="', dark, '" opacity=".75"/>',
                '<circle cx="93" cy="119" r="10" fill="', dark, '" opacity=".75"/>',
                '<path d="M31 134 H50 M78 134 H97" stroke="', dark, '" stroke-width="8" stroke-linecap="round"/>'
            );
            speciesSvg = string.concat('<ellipse cx="64" cy="100" rx="25" ry="18" fill="#fff" opacity=".32"/><circle cx="64" cy="94" r="5" fill="', dark, '"/><path d="M55 104 Q64 111 73 104" stroke="', dark, '" stroke-width="3" fill="none" stroke-linecap="round"/>');
            shineSvg = '<ellipse cx="43" cy="59" rx="17" ry="14" fill="url(#shine)"/>';
        } else if (t.species == 6) { // Frog
            earsSvg = string.concat(
                '<circle cx="34" cy="38" r="18" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<circle cx="94" cy="38" r="18" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<circle cx="34" cy="38" r="6" fill="#fff"/>',
                '<circle cx="94" cy="38" r="6" fill="#fff"/>',
                '<circle cx="34" cy="38" r="3" fill="', dark, '"/>',
                '<circle cx="94" cy="38" r="3" fill="', dark, '"/>'
            );
            limbsSvg = string.concat(
                '<path d="M22 120 C10 123 9 136 27 134 H43" fill="', dark, '"/>',
                '<path d="M106 120 C118 123 119 136 101 134 H85" fill="', dark, '"/>'
            );
            speciesSvg = string.concat('<path d="M38 101 Q64 116 90 101" stroke="', dark, '" stroke-width="4" fill="none" stroke-linecap="round"/>');
            shineSvg = '<ellipse cx="44" cy="65" rx="17" ry="12" fill="url(#shine)"/>';
        } else { // Turtle
            earsSvg = string.concat(
                '<ellipse cx="64" cy="56" rx="22" ry="18" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<path d="M17 91 C6 91 4 103 17 106 M111 91 C122 91 124 103 111 106" stroke="', dark, '" stroke-width="8" stroke-linecap="round" fill="none"/>'
            );
            limbsSvg = string.concat('<path d="M29 124 L18 136 H42 Z" fill="', dark, '"/><path d="M99 124 L110 136 H86 Z" fill="', dark, '"/>');
            shellSvg = string.concat(
                '<ellipse cx="64" cy="94" rx="42" ry="35" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>',
                '<ellipse cx="64" cy="94" rx="27" ry="24" fill="none" stroke="', dark, '" stroke-width="5" opacity=".78"/>',
                '<path d="M37 94 H91 M64 70 V118 M46 78 Q64 91 82 78 M46 110 Q64 97 82 110" stroke="', dark, '" stroke-width="3" fill="none" opacity=".78"/>'
            );
            shineSvg = '<ellipse cx="50" cy="81" rx="15" ry="11" fill="url(#shine)"/>';
        }

        string memory defsSvg = string.concat(
            '<defs><linearGradient id="body" x1="20" y1="30" x2="104" y2="132">',
            '<stop offset="0%" stop-color="#fff" stop-opacity=".34"/><stop offset="32%" stop-color="', body,
            '"/><stop offset="100%" stop-color="', dark, '" stop-opacity=".28"/></linearGradient>',
            '<radialGradient id="shine" cx="35%" cy="26%" r="58%"><stop offset="0%" stop-color="#fff" stop-opacity=".42"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
        );
        string memory bodySvg = t.species == 1 ? speciesSvg : (
            t.species == 2 ? string.concat('<path d="M30 48 H98 Q106 48 106 56 V78 Q106 86 98 86 H30 Q22 86 22 78 V56 Q22 48 30 48 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/><path d="M38 88 H90 Q99 88 101 98 L104 119 Q105 129 95 131 H33 Q23 129 24 119 L27 98 Q29 88 38 88 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 3 ? string.concat('<path d="M31 72 C29 48 43 35 64 38 C85 35 99 48 97 72 L94 105 C91 127 78 137 64 134 C50 137 37 127 34 105 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 4 ? string.concat('<path d="M20 73 C18 50 35 37 59 38 H74 C96 38 109 52 107 75 L103 105 C99 127 82 137 61 133 C38 135 22 121 20 98 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 5 ? string.concat('<path d="M22 74 C20 49 38 35 64 36 C90 35 108 49 106 74 L104 99 C102 124 88 138 64 135 C40 138 26 124 24 99 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 6 ? string.concat('<path d="M14 82 C14 58 34 47 64 48 C94 47 114 58 114 82 C114 115 94 134 64 131 C34 134 14 115 14 82 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 7 ? shellSvg :
            string.concat('<path d="M22 68 C19 44 38 30 64 34 C90 30 109 44 106 68 L102 101 C100 125 84 137 62 133 C38 137 22 122 22 98 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>')
        );
        if (t.species == 1) {
            bodySvg = shellSvg;
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

        uint8 stage = _evolution[tokenId];
        string memory evolutionSvg = "";
        if (stage == 1) {
            evolutionSvg = '<circle cx="64" cy="74" r="58" fill="none" stroke="#fff" stroke-width="2" opacity="0.28"/>';
        } else if (stage == 2) {
            evolutionSvg = '<circle cx="64" cy="74" r="58" fill="none" stroke="#fff" stroke-width="2" opacity="0.28"/><path d="M18 28 L24 18 L30 28 M98 28 L104 18 L110 28" stroke="#ffd700" stroke-width="4" fill="none" stroke-linecap="round"/>';
        } else if (stage == 3) {
            evolutionSvg = '<circle cx="64" cy="74" r="58" fill="none" stroke="#ffd700" stroke-width="3" opacity="0.5"/><path d="M16 30 L24 16 L32 30 M96 30 L104 16 L112 30 M34 16 L40 6 L46 16 M82 16 L88 6 L94 16" stroke="#ffd700" stroke-width="4" fill="none" stroke-linecap="round"/>';
        }

        string memory sceneSvg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 148" width="100%" height="100%">',
            defsSvg,
            '<rect width="128" height="148" fill="', bg, '"/>',
            habitatSvg,
            '<ellipse cx="64" cy="137" rx="45" ry="8" fill="', dark, '" opacity=".24"/>',
            evolutionSvg,
            '<g><animateTransform attributeName="transform" type="translate" values="', motionValues, '" dur="', motionDur, '" repeatCount="indefinite"/>'
        );
        string memory characterSvg = string.concat(
            earsSvg,
            limbsSvg,
            bodySvg,
            shineSvg,
            '<rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>',
            '<rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>'
        );
        string memory faceSvg = string.concat(
            eyesSvg,
            '<rect x="60" y="96" width="8" height="5" rx="2" fill="', dark, '"/>',
            speciesSvg,
            accSvg,
            '</g>',
            '</svg>'
        );
        return string.concat(sceneSvg, characterSvg, faceSvg);
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
