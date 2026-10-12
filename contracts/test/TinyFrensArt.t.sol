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
            bytes32(0x4d0b7e1603f63f5238e97cff8e9f41d9d20c48434be80d0712ec761b70752402),
            bytes32(0x9ee7059871ede3b246da37f041c5213c084eeeb94b1283bc1151e1136204e47e),
            bytes32(0xf4e471e48f665e0ce0ef768392aa1824fa0bfbec8dd87ee8fcf345a74dd85065),
            bytes32(0x275fb707a0b3afa0dd77ed292db243635ec9c717979cca6ab9582571671f0e9e),
            bytes32(0x8f706c0bea6e73d893a436e73db5ab3512dfd3e25d1f53b62dfa36b8cd0be378),
            bytes32(0x9e9b73483c54ddc34cf9be9d3016849f579e63d253bd8c5fea8e119bbb8b7343)
        ];
        for (uint8 i; i < 6; i++) {
            Traits memory traits = Traits(0, i, i % 4, i, i % 3, i, i % 4);
            assertEq(sha256(bytes(art.render(traits, 0))), expected[i]);
        }
    }
}
