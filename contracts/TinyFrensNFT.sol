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
        string memory bodyRadius = 'rx="38" ry="32"';
        string memory shellSvg = "";
        string memory speciesSvg = "";
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
                '<polygon points="20,40 36,4 52,40" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>',
                '<polygon points="76,40 92,4 108,40" fill="', body, '" stroke="', dark, '" stroke-width="7" stroke-linejoin="round"/>'
            );
            speciesSvg = string.concat(
                '<path d="M112 116 C136 105 122 80 104 92" fill="none" stroke="', dark, '" stroke-width="8" stroke-linecap="round"/>',
                '<path d="M25 93 H10 M103 93 H118" stroke="', dark, '" stroke-width="3" stroke-linecap="round"/>'
            );
        } else if (t.species == 1) { // Blob
            bodyRadius = 'rx="48" ry="40"';
            speciesSvg = string.concat(
                '<path d="M26 52 C15 76 14 114 36 129 C50 139 54 124 66 130 C88 141 115 119 112 86 C109 51 91 41 69 48 C50 37 35 36 26 52 Z" fill="', body, '" stroke="', dark, '" stroke-width="8"/>'
            );
        } else if (t.species == 2) { // Robot
            earsSvg = string.concat(
                '<rect x="60" y="8" width="8" height="24" fill="', dark, '"/>',
                '<circle cx="64" cy="8" r="6" fill="', body, '" stroke="', dark, '" stroke-width="3"/>'
            );
            bodyRadius = 'rx="8" ry="8"';
            speciesSvg = string.concat(
                '<rect x="20" y="120" width="88" height="10" rx="2" fill="', dark, '" opacity="0.28"/>',
                '<circle cx="22" cy="82" r="5" fill="', dark, '"/><circle cx="106" cy="82" r="5" fill="', dark, '"/>'
            );
        } else if (t.species == 3) { // Bunny
            earsSvg = string.concat(
                '<rect x="26" y="2" width="20" height="50" rx="10" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<rect x="82" y="2" width="20" height="50" rx="10" fill="', body, '" stroke="', dark, '" stroke-width="7"/>'
            );
            speciesSvg = '<rect x="58" y="101" width="5" height="9" rx="1" fill="#fff"/><rect x="65" y="101" width="5" height="9" rx="1" fill="#fff"/>';
        } else if (t.species == 4) { // Puppy
            earsSvg = string.concat(
                '<rect x="6" y="38" width="24" height="42" rx="10" transform="rotate(-25 6 38)" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<rect x="98" y="28" width="24" height="42" rx="10" transform="rotate(25 98 28)" fill="', body, '" stroke="', dark, '" stroke-width="7"/>'
            );
            speciesSvg = string.concat('<ellipse cx="64" cy="98" rx="21" ry="15" fill="#fff" opacity="0.35"/><circle cx="64" cy="94" r="5" fill="', dark, '"/>');
        } else if (t.species == 5) { // Bear
            earsSvg = string.concat(
                '<circle cx="28" cy="30" r="16" fill="', body, '" stroke="', dark, '" stroke-width="7"/>',
                '<circle cx="100" cy="30" r="16" fill="', body, '" stroke="', dark, '" stroke-width="7"/>'
            );
            speciesSvg = string.concat('<ellipse cx="64" cy="101" rx="24" ry="17" fill="#fff" opacity="0.3"/><circle cx="64" cy="96" r="5" fill="', dark, '"/>');
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
            speciesSvg = string.concat('<path d="M38 101 Q64 116 90 101" stroke="', dark, '" stroke-width="4" fill="none" stroke-linecap="round"/>');
        } else { // Turtle
            bodyRadius = 'rx="48" ry="40"';
            shellSvg = string.concat(
                '<ellipse cx="64" cy="86" rx="38" ry="33" fill="none" stroke="', dark, '" stroke-width="6"/>',
                '<path d="M32 86 H96 M64 53 V119 M42 62 Q64 80 86 62 M42 110 Q64 92 86 110" stroke="', dark, '" stroke-width="3" fill="none" opacity="0.75"/>'
            );
        }

        string memory defsSvg = string.concat(
            '<defs><linearGradient id="body" x1="20" y1="30" x2="104" y2="132">',
            '<stop offset="0%" stop-color="#fff" stop-opacity=".34"/><stop offset="32%" stop-color="', body,
            '"/><stop offset="100%" stop-color="', dark, '" stop-opacity=".28"/></linearGradient>',
            '<radialGradient id="shine" cx="35%" cy="26%" r="58%"><stop offset="0%" stop-color="#fff" stop-opacity=".42"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
        );
        string memory limbsSvg = string.concat(
            '<path d="M16 84 C5 94 8 111 22 112" fill="none" stroke="', dark, '" stroke-width="8" stroke-linecap="round"/>',
            '<path d="M112 84 C123 94 120 111 106 112" fill="none" stroke="', dark, '" stroke-width="8" stroke-linecap="round"/>',
            '<path d="M31 128 C36 121 45 121 50 129 L50 137 H25 L25 132 C25 130 27 129 31 128 Z" fill="', dark, '"/>',
            '<path d="M78 129 C83 121 92 121 98 128 C102 129 104 131 104 134 L104 137 H78 Z" fill="', dark, '"/>'
        );
        string memory bodySvg = t.species == 1 ? speciesSvg : (
            t.species == 2 ? string.concat('<rect x="12" y="34" width="104" height="98" ', bodyRadius, ' fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 3 ? string.concat('<path d="M28 70 C24 46 40 30 64 34 C88 30 104 46 100 70 L98 100 C96 124 82 136 64 134 C46 136 32 124 30 100 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 4 ? string.concat('<path d="M18 72 C18 50 34 37 59 38 H76 C96 38 110 53 108 76 L103 104 C99 126 82 137 60 133 C36 135 20 120 18 96 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 5 ? string.concat('<path d="M20 72 C18 48 36 34 64 35 C92 34 110 48 108 72 L106 98 C104 124 88 138 64 135 C40 138 24 124 22 98 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 6 ? string.concat('<path d="M14 80 C14 54 34 43 64 45 C94 43 114 54 114 80 C114 116 94 136 64 132 C34 136 14 116 14 80 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            t.species == 7 ? string.concat('<path d="M16 86 C16 58 36 44 64 46 C92 44 112 58 112 86 C112 114 92 132 64 132 C36 132 16 114 16 86 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>') :
            string.concat('<path d="M22 68 C19 44 38 30 64 34 C90 30 109 44 106 68 L102 101 C100 125 84 137 62 133 C38 137 22 122 22 98 Z" fill="url(#body)" stroke="', dark, '" stroke-width="8"/>')
        );

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
            '<ellipse cx="42" cy="55" rx="18" ry="14" fill="url(#shine)"/>',
            shellSvg,
            '<rect x="18" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>',
            '<rect x="96" y="88" width="14" height="8" rx="4" fill="#ff82a7"/>'
        );
        string memory faceSvg = string.concat(
            eyesSvg,
            '<rect x="60" y="96" width="8" height="5" rx="2" fill="', dark, '"/>',
            t.species == 1 ? "" : speciesSvg,
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
