// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TinyFrensArt, Traits} from "../TinyFrensArt.sol";
import {TinyFrensSprite} from "../TinyFrensSprite.sol";
import {LibString} from "solady/utils/LibString.sol";

contract TinyFrensArtTest is Test {
    using LibString for string;
    TinyFrensArt internal art;

    function setUp() public {
        art = new TinyFrensArt(address(new TinyFrensSprite()));
    }

    function testRendererKeepsDeploymentHeadroom() public view {
        assertLe(address(art).code.length, 24000, "Keep room below EIP-170's 24576-byte limit");
        assertLe(address(art.spriteRenderer()).code.length, 24000, "Sprite must also fit EIP-170");
    }

    function testHeadwearReplacesAntennaAndMeetsHead() public view {
        Traits memory traits;
        string memory antenna = 'd="M46 18h3v9h-3z"';
        assertTrue(art.render(traits, 0).contains(antenna));
        for (uint8 accessory = 1; accessory <= 3; accessory++) {
            traits.acc = accessory;
            string memory svg = art.render(traits, 0);
            assertFalse(svg.contains(antenna));
            if (accessory == 1) assertTrue(svg.contains('d="M30 24h36v3h-36z"'));
            if (accessory == 2) assertTrue(svg.contains('d="M33 24h30v3h-30z"'));
        }
    }

    function testFeetAreOutsideBobbingTorso() public view {
        Traits memory traits;
        string memory svg = art.render(traits, 0);
        // Arm closes, then torso closes, before the first foot opens.
        assertTrue(svg.contains('</g></g><g class="foot-a">'));
        assertTrue(svg.contains('12.5%{transform:translate(0,-1px)}'));
        assertTrue(svg.contains('@media(prefers-reduced-motion:reduce)'));
    }

    function testEachHabitatHasDistinctArtwork() public view {
        Traits memory traits;
        bytes32[6] memory seen;
        for (uint8 habitat = 0; habitat < 6; habitat++) {
            traits.habitat = habitat;
            seen[habitat] = keccak256(bytes(art.render(traits, 0)));
            for (uint8 other = 0; other < habitat; other++) assertTrue(seen[habitat] != seen[other]);
        }
    }

    function testBrowserPreviewParity() public view {
        // SHA-256 fixtures from web/nft-art.mjs renderNftArt for these six trait sets.
        // Covers every accessory and habitat, plus all motion and expression values.
        bytes32[6] memory expected = [
            bytes32(0xff966c1cad1ce001fa1331fc5cd82b9262306f8e252cb441296b165555b7886a),
            bytes32(0xd4201aa5a6d5a13e4425df1e59f909eeb70b3748b39691f0a14016c8e034a2da),
            bytes32(0xa654d413b32ed1e9a725e1bb8493e98fc0aa43259c53d0c33385fb1eb0512199),
            bytes32(0xca0defd054b8899fdaab27806efad1b076ff1b03dac21eeec19536d29cb85a1c),
            bytes32(0xf3c6ecc64548022cc0e6cd9c08fde9c26c85cccbe672e8d19ac1635cb2ae233b),
            bytes32(0x502b308304a52c80f046f95cfacd20b48ecd3587ec2d139df78c77d71ba4458a)
        ];
        for (uint8 i; i < 6; i++) {
            Traits memory traits = Traits(0, i, i % 4, i, i % 3, i, i % 4, uint16(i) * 10923);
            assertEq(sha256(bytes(art.render(traits, 0))), expected[i]);
        }
    }
}
