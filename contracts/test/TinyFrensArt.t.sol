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
            bytes32(0x1036e09ea99a09be7da2e0452ebc158c4fcabc6f3474360c3265be4f6c8cdf51),
            bytes32(0x70a3557c2a6e48135960b6f924ca449b1bed4de9106a3738e59225d686907ebb),
            bytes32(0xbc13cbc01dd883efc19d3950c5ea502cae64802b711abb057547c669ec529cc7),
            bytes32(0xf7fe89030898baf83fc71aff88b14a139e2df37679ea9765b1b573b5ac238c15),
            bytes32(0x77628b4b27b728fa1c4e2ce59a12af0397b831060b279a8a18eaf34c8f6b01e4),
            bytes32(0xb2e33a093c7a54085cec1f03ab0238f585b772a6c0bca994f650db2eba35f211)
        ];
        for (uint8 i; i < 6; i++) {
            Traits memory traits = Traits(0, i, i % 4, i, i % 3, i, i % 4);
            assertEq(sha256(bytes(art.render(traits, 0))), expected[i]);
        }
    }
}
