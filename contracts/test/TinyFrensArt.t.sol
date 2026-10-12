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
            bytes32(0xec29fb3a38ab06420e0dd24f7030d3734df65201ee882c4ce422aeff37624fb1),
            bytes32(0xd0db03d4f04785aacf7b32de39f7244284ade7cfd60727b33adc589c5470ab83),
            bytes32(0x6a7313bb27e333a07e092bbe09b310ec859f24916025ced3c262695b3cc5547c),
            bytes32(0x25c1bc839fbfa0862adbc6568785c303597595b9c139f4c23b820dee1458c266),
            bytes32(0x31d8cdeb86d053b5286bb2d94d788d815ca5390f0bcf2b2d7cdbdffb8c505c82),
            bytes32(0x80a2de68fe96b188727841b8437e8c1786d211ef121181ae55685d7e44c666dd)
        ];
        for (uint8 i; i < 6; i++) {
            Traits memory traits = Traits(0, i, i % 4, i, i % 3, i, i % 4);
            assertEq(sha256(bytes(art.render(traits, 0))), expected[i]);
        }
    }
}
