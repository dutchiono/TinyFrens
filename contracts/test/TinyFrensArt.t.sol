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

    function testHatsReplaceAntennaAndMeetHead() public view {
        Traits memory traits;
        string memory antenna = '<rect x="31" y="12" width="2" height="6"';
        assertTrue(art.render(traits, 0).contains(antenna));
        for (uint8 accessory = 1; accessory <= 3; accessory++) {
            traits.acc = accessory;
            string memory svg = art.render(traits, 0);
            assertFalse(svg.contains(antenna));
            if (accessory == 1) assertTrue(svg.contains('<rect x="23" y="16" width="18" height="2"'));
            if (accessory == 2) assertTrue(svg.contains('<rect x="22" y="15" width="20" height="3"'));
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
            bytes32(0xed3b7bc7397706f91c8ddc1d2a3d5fe42bb356f55610c231d981b371f7156f06),
            bytes32(0xa54e50bc600ec481e77d9a20751e0040933b4d898ee82cde0625db54675f93dd),
            bytes32(0x37f52225f8cc98951349295ae2b03bd8ca041613918feddd21e92aeabdc29f94),
            bytes32(0x51301874911e22705511d6001af0619e0b7f6b4eb3bf151d666be9efb2a1368b),
            bytes32(0x4d0d04916debb83dc3b5c9d4aacb54621eb3c4f999968aec52dc80c172bca079),
            bytes32(0x11bfc19db2de4ce25a41db238452c39bfb50002f3465aa2eafb26c4bf5bb28af)
        ];
        for (uint8 i; i < 6; i++) {
            Traits memory traits = Traits(0, i, i % 4, i, i % 3, i, i % 4);
            assertEq(sha256(bytes(art.render(traits, 0))), expected[i]);
        }
    }
}
