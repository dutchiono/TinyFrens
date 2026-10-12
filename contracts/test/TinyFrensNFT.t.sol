// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TinyFrensNFT} from "../TinyFrensNFT.sol";

contract TinyFrensNFTTest is Test {
    TinyFrensNFT internal nft;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        nft = new TinyFrensNFT();
        vm.deal(alice, 1 ether);
    }

    function testMintPriceIsEth() public {
        assertEq(nft.price(), 0.001 ether);
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);
        assertEq(nft.ownerOf(1), alice);
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
}
