// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {JackpotVault} from "../economy/JackpotVault.sol";
import {TestFRENS} from "../testnet/TestFRENS.sol";

contract JackpotVaultV2 is JackpotVault {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract JackpotVaultTest is Test {
    event ControllerUpdated(address indexed controller);
    event PoolCreated(bytes32 indexed poolId, address indexed token);
    event PoolActiveUpdated(bytes32 indexed poolId, bool active);
    event PoolFunded(bytes32 indexed poolId, address indexed from, uint256 amount);
    event JackpotWon(bytes32 indexed poolId, address indexed winner, address indexed token, uint256 amount);

    bytes32 internal constant ETH_POOL = keccak256("eth-daily");
    bytes32 internal constant FRENS_POOL = keccak256("frens-weekly");

    address internal controller = makeAddr("controller");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    JackpotVault internal vault;
    TestFRENS internal frens;

    function setUp() public {
        JackpotVault impl = new JackpotVault();
        bytes memory data = abi.encodeCall(JackpotVault.initialize, (address(this), controller));
        vault = JackpotVault(payable(address(new ERC1967Proxy(address(impl), data))));
        frens = new TestFRENS(address(this));
    }

    function _createEthPool() internal {
        vault.createPool(ETH_POOL, address(0));
    }

    function _createFrensPool() internal {
        vault.createPool(FRENS_POOL, address(frens));
    }

    function testInitialize() public view {
        assertEq(vault.owner(), address(this));
        assertEq(vault.gameController(), controller);
    }

    function testImplementationCannotBeInitialized() public {
        JackpotVault impl = new JackpotVault();
        vm.expectRevert();
        impl.initialize(address(this), controller);
    }

    function testCreatePoolOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.createPool(ETH_POOL, address(0));
    }

    function testCreatePoolAndDuplicate() public {
        vm.expectEmit(true, true, false, true);
        emit PoolCreated(ETH_POOL, address(0));
        _createEthPool();

        (address token, uint256 balance, bool active) = vault.poolInfo(ETH_POOL);
        assertEq(token, address(0));
        assertEq(balance, 0);
        assertTrue(active);

        vm.expectRevert(JackpotVault.PoolExists.selector);
        _createEthPool();
    }

    function testFundEthPool() public {
        _createEthPool();
        vm.deal(alice, 2 ether);
        vm.expectEmit(true, true, false, true);
        emit PoolFunded(ETH_POOL, alice, 1 ether);
        vm.prank(alice);
        vault.fundETH{value: 1 ether}(ETH_POOL);

        (, uint256 balance,) = vault.poolInfo(ETH_POOL);
        assertEq(balance, 1 ether);
        assertEq(address(vault).balance, 1 ether);
    }

    function testFundUnknownPoolReverts() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(JackpotVault.UnknownPool.selector);
        vault.fundETH{value: 1 ether}(ETH_POOL);
    }

    function testFundEthIntoTokenPoolReverts() public {
        _createFrensPool();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(JackpotVault.TokenMismatch.selector);
        vault.fundETH{value: 1 ether}(FRENS_POOL);
    }

    function testFundTokenIntoEthPoolReverts() public {
        _createEthPool();
        frens.mint(alice, 1 ether);
        vm.startPrank(alice);
        frens.approve(address(vault), 1 ether);
        vm.expectRevert(JackpotVault.TokenMismatch.selector);
        vault.fundERC20(ETH_POOL, 1 ether);
        vm.stopPrank();
    }

    function testFundFrensPool() public {
        _createFrensPool();
        frens.mint(alice, 100 ether);
        vm.startPrank(alice);
        frens.approve(address(vault), 50 ether);
        vm.expectEmit(true, true, false, true);
        emit PoolFunded(FRENS_POOL, alice, 50 ether);
        vault.fundERC20(FRENS_POOL, 50 ether);
        vm.stopPrank();

        (, uint256 balance,) = vault.poolInfo(FRENS_POOL);
        assertEq(balance, 50 ether);
        assertEq(frens.balanceOf(address(vault)), 50 ether);
    }

    function testDrawWinnerOnlyController() public {
        _createEthPool();
        vm.deal(address(vault), 1 ether);
        vm.prank(alice);
        vm.expectRevert(JackpotVault.NotController.selector);
        vault.drawWinner(ETH_POOL, bob, 0.1 ether);
    }

    function testDrawWinnerUnknownPool() public {
        vm.prank(controller);
        vm.expectRevert(JackpotVault.UnknownPool.selector);
        vault.drawWinner(ETH_POOL, bob, 0.1 ether);
    }

    function testDrawWinnerEth() public {
        _createEthPool();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.fundETH{value: 1 ether}(ETH_POOL);

        vm.expectEmit(true, true, true, true);
        emit JackpotWon(ETH_POOL, bob, address(0), 0.4 ether);
        vm.prank(controller);
        vault.drawWinner(ETH_POOL, bob, 0.4 ether);

        assertEq(bob.balance, 0.4 ether);
        (, uint256 balance,) = vault.poolInfo(ETH_POOL);
        assertEq(balance, 0.6 ether);
        assertEq(address(vault).balance, 0.6 ether);
    }

    function testDrawWinnerFrens() public {
        _createFrensPool();
        frens.mint(alice, 10 ether);
        vm.startPrank(alice);
        frens.approve(address(vault), 10 ether);
        vault.fundERC20(FRENS_POOL, 10 ether);
        vm.stopPrank();

        vm.prank(controller);
        vault.drawWinner(FRENS_POOL, bob, 4 ether);

        assertEq(frens.balanceOf(bob), 4 ether);
        (, uint256 balance,) = vault.poolInfo(FRENS_POOL);
        assertEq(balance, 6 ether);
    }

    function testDrawWinnerInsufficientPool() public {
        _createEthPool();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.fundETH{value: 1 ether}(ETH_POOL);
        vm.prank(controller);
        vm.expectRevert(JackpotVault.InsufficientPool.selector);
        vault.drawWinner(ETH_POOL, bob, 2 ether);
    }

    function testDrawWinnerInactivePool() public {
        _createEthPool();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.fundETH{value: 1 ether}(ETH_POOL);
        vault.setPoolActive(ETH_POOL, false);

        vm.prank(controller);
        vm.expectRevert(JackpotVault.InactivePool.selector);
        vault.drawWinner(ETH_POOL, bob, 0.1 ether);
    }

    function testPauseBlocksDrawButAllowsFunding() public {
        _createEthPool();
        vault.pause();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.fundETH{value: 1 ether}(ETH_POOL);

        vm.prank(controller);
        vm.expectRevert();
        vault.drawWinner(ETH_POOL, bob, 0.1 ether);

        vault.unpause();
        vm.prank(controller);
        vault.drawWinner(ETH_POOL, bob, 0.1 ether);
        assertEq(bob.balance, 0.1 ether);
    }

    function testSetController() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.setGameController(alice);
        vault.setGameController(bob);
        assertEq(vault.gameController(), bob);
    }

    function testSetPoolActiveUnknown() public {
        vm.expectRevert(JackpotVault.UnknownPool.selector);
        vault.setPoolActive(ETH_POOL, false);
    }

    function testOnlyOwnerCanUpgrade() public {
        JackpotVaultV2 v2 = new JackpotVaultV2();
        vm.prank(alice);
        vm.expectRevert();
        vault.upgradeToAndCall(address(v2), "");
    }

    function testUpgradePreservesState() public {
        _createEthPool();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.fundETH{value: 1 ether}(ETH_POOL);

        JackpotVaultV2 v2 = new JackpotVaultV2();
        vault.upgradeToAndCall(address(v2), "");

        assertEq(JackpotVaultV2(payable(address(vault))).version(), 2);
        assertEq(vault.gameController(), controller);
        (, uint256 balance,) = vault.poolInfo(ETH_POOL);
        assertEq(balance, 1 ether);
    }
}
