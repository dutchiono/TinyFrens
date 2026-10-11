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
        uint8 species; // 0..7 (111 of each across 888 total supply)
        uint8 palette; // 0..7 (Curated paired body, outline, bg)
        uint8 expr;    // 0..3 (Happy, Wink, Shades, Star Eyes)
        uint8 acc;     // 0..5 (None, Party Hat, Crown, Halo, Bow Tie, Mystic Orb)
    }

    constructor()
        NetIntegratedERC721A(
            "TinyFrens", // name
            "FREN",      // symbol
            0.001 ether, // price (0.001 ETH)
            888,         // maxSupply (111 per species)
            20,          // maxMintsPerWallet
            20           // creatorReserve
        )
    {}

    function _traits(uint256 tokenId) internal view returns (Traits memory t) {
        LibPRNG.PRNG memory p;
        p.seed(uint256(_tokenToSeed[tokenId]));

        // Exactly 111 of each species across 888 supply
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
