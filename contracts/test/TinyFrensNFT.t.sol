// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TinyFrensNFT} from "../TinyFrensNFT.sol";
import {TinyFrensArt} from "../TinyFrensArt.sol";
import {TinyFrensSprite} from "../TinyFrensSprite.sol";
import {TestFRENS} from "../testnet/TestFRENS.sol";
import {LibString} from "solady/utils/LibString.sol";

contract TinyFrensNFTTest is Test {
    using LibString for string;
    TinyFrensNFT internal nft;
    TestFRENS internal token;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        token = new TestFRENS(address(this));
        TinyFrensSprite sprite = new TinyFrensSprite();
        TinyFrensArt art = new TinyFrensArt(address(sprite));
        nft = new TinyFrensNFT(address(art));
        nft.setFrensToken(address(token));
        vm.deal(alice, 1 ether);
        token.mint(alice, 1_000_000_000 * 10**18);
        token.mint(bob, 1_000_000_000 * 10**18);
    }

    function testMintPriceIsEth() public {
        assertEq(nft.price(), 0.001 ether);
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);
        assertEq(nft.ownerOf(1), alice);
    }

    function testRobotOnlyArtHasWalkFrames() public {
        vm.prank(alice);
        nft.mint{value: 0.004 ether}(4);

        for (uint256 tokenId = 1; tokenId <= 4; tokenId++) {
            string memory artwork = nft.art(tokenId);
            assertTrue(artwork.contains('data-species="0"'));
            assertTrue(artwork.contains('shape-rendering="crispEdges"'));
            assertTrue(artwork.contains('class="foot-a"'));
            assertTrue(artwork.contains('class="foot-b"'));
            assertTrue(artwork.contains('class="arm-a"'));
            assertTrue(artwork.contains('class="arm-b"'));
            assertTrue(artwork.contains("@keyframes step-a"));
            assertTrue(artwork.contains("@keyframes arm-a"));
            assertTrue(artwork.contains("<rect"));
        }
    }

    function testOwnerCanRenameAndEvolve() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        (address operator, bytes32 key, string memory text) = nft.netStoragePointer(1);
        assertEq(operator, address(nft));
        assertTrue(key != bytes32(0));
        assertEq(text, "TinyFrens tokenURI #1");

        vm.prank(alice);
        nft.rename(1, "Lil Button");
        assertEq(nft.tokenName(1), "Lil Button");

        vm.prank(alice);
        nft.evolve(1);
        assertEq(nft.evolutionStage(1), 1);
    }

    function testOnlyOwnerCanRenameOrEvolve() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        vm.prank(bob);
        vm.expectRevert(TinyFrensNFT.NotTokenOwner.selector);
        nft.rename(1, "Sneaky");

        vm.prank(bob);
        vm.expectRevert(TinyFrensNFT.NotTokenOwner.selector);
        nft.evolve(1);
    }

    function testRenameRejectsUnsafeJsonCharacters() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        vm.prank(alice);
        vm.expectRevert(TinyFrensNFT.InvalidPetName.selector);
        nft.rename(1, 'Bad " JSON');
    }

    function testEvolutionCapsAtStageThree() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        vm.startPrank(alice);
        nft.evolve(1);
        nft.evolve(1);
        nft.evolve(1);
        vm.expectRevert(TinyFrensNFT.MaxEvolutionReached.selector);
        nft.evolve(1);
        vm.stopPrank();
    }

    function testMintWithVaultCollateral() public {
        uint256 frensRequired = nft.frensPerVaultMint();
        vm.startPrank(alice);
        token.approve(address(nft), frensRequired);
        nft.mintWithVault(1, frensRequired);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.lockedFrens(1), frensRequired);
        assertEq(token.balanceOf(address(nft)), frensRequired);

        string memory uri = nft.tokenURI(1);
        assertTrue(uri.contains("data:application/json"));
    }

    function testUnwrapBurnsAndReturnsFrens() public {
        uint256 frensRequired = nft.frensPerVaultMint();
        vm.startPrank(alice);
        token.approve(address(nft), frensRequired);
        nft.mintWithVault(1, frensRequired);

        uint256 balBefore = token.balanceOf(alice);
        nft.unwrap(1);
        vm.stopPrank();

        assertEq(token.balanceOf(alice), balBefore + frensRequired);
        assertEq(nft.lockedFrens(1), 0);
        assertEq(token.balanceOf(address(nft)), 0);

        // Token #1 is burned
        vm.expectRevert();
        nft.ownerOf(1);
    }

    function testOnlyOwnerCanUnwrap() public {
        uint256 frensRequired = nft.frensPerVaultMint();
        vm.startPrank(alice);
        token.approve(address(nft), frensRequired);
        nft.mintWithVault(1, frensRequired);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(TinyFrensNFT.NotTokenOwner.selector);
        nft.unwrap(1);
    }

    function testCannotUnwrapStandardEthNft() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        vm.prank(alice);
        vm.expectRevert(TinyFrensNFT.NoLockedFrens.selector);
        nft.unwrap(1);
    }
}
