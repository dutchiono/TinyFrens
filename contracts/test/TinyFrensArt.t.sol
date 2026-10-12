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
        assertLe(address(art).code.length, 22000, "Keep room below EIP-170's 24576-byte limit");
    }

    function testHeadwearReplacesAntennaAndMeetsHead() public view {
        Traits memory traits;
        string memory antenna = 'd="M46 18h3v9H46z"';
        assertTrue(art.render(traits, 0).contains(antenna));
        for (uint8 accessory = 1; accessory <= 3; accessory++) {
            traits.acc = accessory;
            string memory svg = art.render(traits, 0);
            assertFalse(svg.contains(antenna));
            if (accessory == 1) assertTrue(svg.contains('d="M30 24h36v3H30z"'));
            if (accessory == 2) assertTrue(svg.contains('d="M33 22h30v5H33z"'));
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
            bytes32(0xf855bc670dafa86da0bf5cc1ba8e7d39f9da0cf63dd8dfa66aaae50b39601f0b),
            bytes32(0xd81e593a2c08cfd726c69945d3bb97c10452079ac730e2dd9827861132d60577),
            bytes32(0x11b4bdf1f7004ab6a0e95c12761bb37289600a24141b5b247636e083d0fc3cc4),
            bytes32(0x7199c645497ffc699464afea0109dfd4650b6da3593f5a8121cbf23788f563ce),
            bytes32(0x86c7528e64b6d8902e2c6c5fe1ef05a020e9a0f8115bd67c150d969f50dfb468),
            bytes32(0xea6d8d4edcf708d182f4376e9ee1bdc29648692e421fa2c28409253722962ea7)
        ];
        for (uint8 i; i < 6; i++) {
            Traits memory traits = Traits(0, i, i % 4, i, i % 3, i, i % 4);
            assertEq(sha256(bytes(art.render(traits, 0))), expected[i]);
        }
    }
}
