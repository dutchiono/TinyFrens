// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Treasury} from "../economy/Treasury.sol";
import {TestFRENS} from "../testnet/TestFRENS.sol";

contract TreasuryV2 is Treasury {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract RevertingReceiver {
    receive() external payable {
        revert("nope");
    }
}

contract TreasuryTest is Test {
    event ControllerUpdated(address indexed controller);
    event Funded(address indexed from, address indexed token, uint256 amount);
    event Payout(address indexed to, address indexed token, uint256 amount);

    address internal controller = makeAddr("controller");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    Treasury internal treasury;
    TestFRENS internal frens;

    function setUp() public {
        Treasury impl = new Treasury();
        bytes memory data = abi.encodeCall(Treasury.initialize, (address(this), controller));
        treasury = Treasury(payable(address(new ERC1967Proxy(address(impl), data))));
        frens = new TestFRENS(address(this));
    }

    function testInitializeSetsOwnerAndController() public view {
        assertEq(treasury.owner(), address(this));
        assertEq(treasury.gameController(), controller);
    }

    function testInitializeEmitsController() public {
        Treasury impl = new Treasury();
        vm.expectEmit(false, false, false, true);
        emit ControllerUpdated(controller);
        new ERC1967Proxy(address(impl), abi.encodeCall(Treasury.initialize, (address(this), controller)));
    }

    function testCannotInitializeTwice() public {
        vm.expectRevert();
        treasury.initialize(address(this), controller);
    }

    function testImplementationCannotBeInitialized() public {
        Treasury impl = new Treasury();
        vm.expectRevert();
        impl.initialize(address(this), controller);
    }

    function testInitializeRejectsZero() public {
        Treasury impl = new Treasury();
        vm.expectRevert(Treasury.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(Treasury.initialize, (address(0), controller)));
    }

    function testReceiveFunds() public {
        vm.deal(alice, 1 ether);
        vm.expectEmit(true, true, false, true);
        emit Funded(alice, address(0), 1 ether);
        vm.prank(alice);
        (bool ok,) = address(treasury).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(treasury).balance, 1 ether);
    }

    function testFundERC20() public {
        frens.mint(alice, 100 ether);
        vm.startPrank(alice);
        frens.approve(address(treasury), 40 ether);
        vm.expectEmit(true, true, false, true);
        emit Funded(alice, address(frens), 40 ether);
        treasury.fundERC20(address(frens), 40 ether);
        vm.stopPrank();

        assertEq(frens.balanceOf(address(treasury)), 40 ether);
        assertEq(frens.balanceOf(alice), 60 ether);
    }

    function testPayETHOnlyController() public {
        vm.deal(address(treasury), 1 ether);
        vm.prank(alice);
        vm.expectRevert(Treasury.NotController.selector);
        treasury.payETH(bob, 0.1 ether);
    }

    function testPayETHTransfers() public {
        vm.deal(address(treasury), 1 ether);
        vm.expectEmit(true, true, false, true);
        emit Payout(bob, address(0), 0.25 ether);
        vm.prank(controller);
        treasury.payETH(bob, 0.25 ether);

        assertEq(bob.balance, 0.25 ether);
        assertEq(address(treasury).balance, 0.75 ether);
    }

    function testPayETHInsufficientBalance() public {
        vm.deal(address(treasury), 0.1 ether);
        vm.prank(controller);
        vm.expectRevert(Treasury.InsufficientBalance.selector);
        treasury.payETH(bob, 1 ether);
    }

    function testPayETHRevertingReceiver() public {
        RevertingReceiver receiver = new RevertingReceiver();
        vm.deal(address(treasury), 1 ether);
        vm.prank(controller);
        vm.expectRevert(Treasury.TransferFailed.selector);
        treasury.payETH(address(receiver), 0.1 ether);
        assertEq(address(treasury).balance, 1 ether);
    }

    function testPayERC20OnlyController() public {
        frens.mint(address(treasury), 10 ether);
        vm.prank(alice);
        vm.expectRevert(Treasury.NotController.selector);
        treasury.payERC20(address(frens), bob, 1 ether);
    }

    function testPayERC20Transfers() public {
        frens.mint(address(treasury), 10 ether);
        vm.expectEmit(true, true, false, true);
        emit Payout(bob, address(frens), 3 ether);
        vm.prank(controller);
        treasury.payERC20(address(frens), bob, 3 ether);

        assertEq(frens.balanceOf(bob), 3 ether);
        assertEq(frens.balanceOf(address(treasury)), 7 ether);
    }

    function testPauseBlocksPayoutButAllowsFunding() public {
        vm.deal(address(treasury), 1 ether);
        treasury.pause();

        vm.prank(controller);
        vm.expectRevert();
        treasury.payETH(bob, 0.1 ether);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(treasury).call{value: 1 ether}("");
        assertTrue(ok);

        treasury.unpause();
        vm.prank(controller);
        treasury.payETH(bob, 0.1 ether);
        assertEq(bob.balance, 0.1 ether);
    }

    function testSetControllerOnlyOwnerAndZeroRejected() public {
        vm.prank(alice);
        vm.expectRevert();
        treasury.setGameController(alice);

        treasury.setGameController(bob);
        assertEq(treasury.gameController(), bob);

        vm.expectRevert(Treasury.ZeroAddress.selector);
        treasury.setGameController(address(0));
    }

    function testOnlyOwnerCanUpgrade() public {
        TreasuryV2 v2 = new TreasuryV2();
        vm.prank(alice);
        vm.expectRevert();
        treasury.upgradeToAndCall(address(v2), "");
    }

    function testUpgradePreservesState() public {
        vm.deal(address(treasury), 1 ether);
        TreasuryV2 v2 = new TreasuryV2();
        treasury.upgradeToAndCall(address(v2), "");

        assertEq(TreasuryV2(payable(address(treasury))).version(), 2);
        assertEq(treasury.owner(), address(this));
        assertEq(treasury.gameController(), controller);
        assertEq(address(treasury).balance, 1 ether);
    }
}
