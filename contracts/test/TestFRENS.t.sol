// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TestFRENS} from "../testnet/TestFRENS.sol";

/// @notice Unit tests for the Base Sepolia test utility token.
contract TestFRENSTest is Test {
    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    TestFRENS internal token;
    address internal minter = address(this);
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        token = new TestFRENS(minter);
    }

    function testMetadata() public view {
        assertEq(token.name(), "TinyFrens Test FRENS");
        assertEq(token.symbol(), "tfFRENS");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 0);
    }

    function testConstructorRejectsZeroMinter() public {
        vm.expectRevert(bytes("minter"));
        new TestFRENS(address(0));
    }

    function testMintOnlyMinter() public {
        vm.prank(alice);
        vm.expectRevert(bytes("not minter"));
        token.mint(alice, 1 ether);
    }

    function testMintUpdatesSupplyAndBalance() public {
        vm.expectEmit(true, true, false, true);
        emit Transfer(address(0), alice, 100 ether);
        token.mint(alice, 100 ether);

        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.totalSupply(), 100 ether);
    }

    function testMintRejectsZeroRecipient() public {
        vm.expectRevert(bytes("zero"));
        token.mint(address(0), 1 ether);
    }

    function testMintAccumulates() public {
        token.mint(alice, 5 ether);
        token.mint(alice, 7 ether);
        assertEq(token.balanceOf(alice), 12 ether);
        assertEq(token.totalSupply(), 12 ether);
    }

    function testTransfer() public {
        token.mint(alice, 10 ether);

        vm.expectEmit(true, true, false, true);
        emit Transfer(alice, bob, 4 ether);
        vm.prank(alice);
        assertTrue(token.transfer(bob, 4 ether));

        assertEq(token.balanceOf(alice), 6 ether);
        assertEq(token.balanceOf(bob), 4 ether);
    }

    function testTransferInsufficientBalance() public {
        token.mint(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("balance"));
        token.transfer(bob, 2 ether);
    }

    function testTransferToZeroRejected() public {
        token.mint(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(bytes("zero"));
        token.transfer(address(0), 1 ether);
    }

    function testApproveAndTransferFrom() public {
        token.mint(alice, 10 ether);

        vm.expectEmit(true, true, false, true);
        emit Approval(alice, bob, 5 ether);
        vm.prank(alice);
        assertTrue(token.approve(bob, 5 ether));
        assertEq(token.allowance(alice, bob), 5 ether);

        vm.prank(bob);
        assertTrue(token.transferFrom(alice, bob, 3 ether));

        assertEq(token.balanceOf(alice), 7 ether);
        assertEq(token.balanceOf(bob), 3 ether);
        assertEq(token.allowance(alice, bob), 2 ether);
    }

    function testTransferFromWithoutAllowance() public {
        token.mint(alice, 10 ether);
        vm.prank(bob);
        vm.expectRevert(bytes("allowance"));
        token.transferFrom(alice, bob, 1 ether);
    }

    function testTransferFromInfiniteAllowanceNotDecremented() public {
        token.mint(alice, 10 ether);
        vm.prank(alice);
        token.approve(bob, type(uint256).max);

        vm.prank(bob);
        token.transferFrom(alice, bob, 4 ether);

        assertEq(token.allowance(alice, bob), type(uint256).max);
    }

    function testFuzzMintAndTransfer(uint128 minted, uint128 sent) public {
        token.mint(alice, minted);
        vm.assume(sent <= minted);

        vm.prank(alice);
        token.transfer(bob, sent);

        assertEq(token.balanceOf(alice), uint256(minted) - sent);
        assertEq(token.balanceOf(bob), sent);
        assertEq(token.totalSupply(), minted);
    }
}
