// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Treasury} from "../economy/Treasury.sol";
import {DepositSession} from "../economy/DepositSession.sol";
import {DepositRouter} from "../economy/DepositRouter.sol";
import {TestFRENS} from "../testnet/TestFRENS.sol";

contract DepositRouterV2 is DepositRouter {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract DepositRouterTest is Test {
    event Deposit(bytes32 indexed sessionId, address indexed sender, address indexed token, uint256 amount);
    event SessionCreated(bytes32 indexed sessionId, address indexed session, address indexed token);
    event SessionClosed(bytes32 indexed sessionId, address indexed session);

    address internal controller = makeAddr("controller");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    Treasury internal treasury;
    DepositSession internal sessionImpl;
    DepositRouter internal router;
    TestFRENS internal frens;

    bytes32 internal constant SESSION = keccak256("session-1");
    bytes32 internal constant SESSION2 = keccak256("session-2");

    function setUp() public {
        Treasury treasuryImpl = new Treasury();
        treasury = Treasury(
            payable(
                address(
                    new ERC1967Proxy(
                        address(treasuryImpl),
                        abi.encodeCall(Treasury.initialize, (address(this), controller))
                    )
                )
            )
        );

        sessionImpl = new DepositSession();

        DepositRouter routerImpl = new DepositRouter();
        router = DepositRouter(
            payable(
                address(
                    new ERC1967Proxy(
                        address(routerImpl),
                        abi.encodeCall(
                            DepositRouter.initialize,
                            (address(this), controller, address(treasury), address(sessionImpl))
                        )
                    )
                )
            )
        );

        frens = new TestFRENS(address(this));
    }

    function testInitialize() public view {
        assertEq(router.owner(), address(this));
        assertEq(router.gameController(), controller);
        assertEq(router.treasury(), address(treasury));
        assertEq(router.sessionImplementation(), address(sessionImpl));
    }

    function testImplementationCannotBeInitialized() public {
        DepositSession impl = new DepositSession();
        vm.expectRevert(DepositSession.AlreadyInitialized.selector);
        impl.initialize(address(treasury), address(0), SESSION);
    }

    function testCreateSessionOnlyController() public {
        vm.prank(alice);
        vm.expectRevert(DepositRouter.NotController.selector);
        router.createSession(SESSION, address(0));
    }

    function testCreateSessionEth() public {
        vm.prank(controller);
        address session = router.createSession(SESSION, address(0));

        assertTrue(session != address(0));
        assertEq(router.sessionAddress(SESSION), session);
        assertEq(router.sessionIdOf(session), SESSION);
        assertEq(DepositSession(payable(session)).treasury(), address(treasury));
        assertEq(DepositSession(payable(session)).sessionId(), SESSION);
    }

    function testCreateSessionDuplicateReverts() public {
        vm.prank(controller);
        router.createSession(SESSION, address(0));
        vm.prank(controller);
        vm.expectRevert(DepositRouter.SessionExists.selector);
        router.createSession(SESSION, address(0));
    }

    function testCreateSessionZeroIdReverts() public {
        vm.prank(controller);
        vm.expectRevert(DepositRouter.ZeroAddress.selector);
        router.createSession(bytes32(0), address(0));
    }

    function testEthDepositForwardsAndEmits() public {
        vm.prank(controller);
        address session = router.createSession(SESSION, address(0));

        vm.deal(alice, 1 ether);
        vm.expectEmit(true, true, true, true);
        emit Deposit(SESSION, alice, address(0), 0.5 ether);
        vm.prank(alice);
        (bool ok,) = session.call{value: 0.5 ether}("");
        assertTrue(ok);

        assertEq(address(treasury).balance, 0.5 ether);
        assertEq(session.balance, 0);
    }

    function testEthDepositToTokenSessionReverts() public {
        vm.prank(controller);
        address session = router.createSession(SESSION, address(frens));

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = session.call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(address(treasury).balance, 0);
    }

    function testErc20DepositSweepForwardsAndEmits() public {
        vm.prank(controller);
        address session = router.createSession(SESSION, address(frens));

        frens.mint(alice, 100 ether);
        vm.prank(alice);
        frens.transfer(session, 40 ether);
        assertEq(frens.balanceOf(session), 40 ether);

        vm.expectEmit(true, true, true, true);
        emit Deposit(SESSION, bob, address(frens), 40 ether);
        vm.prank(bob);
        DepositSession(payable(session)).sweep();

        assertEq(frens.balanceOf(address(treasury)), 40 ether);
        assertEq(frens.balanceOf(session), 0);
    }

    function testSweepEthSessionReverts() public {
        vm.prank(controller);
        address session = router.createSession(SESSION, address(0));
        vm.expectRevert(DepositSession.SweepNotForEth.selector);
        DepositSession(payable(session)).sweep();
    }

    function testSweepEmptyTokenSessionReverts() public {
        vm.prank(controller);
        address session = router.createSession(SESSION, address(frens));
        vm.expectRevert(DepositSession.NothingToSweep.selector);
        DepositSession(payable(session)).sweep();
    }

    function testSessionsAreUnique() public {
        vm.startPrank(controller);
        address a = router.createSession(SESSION, address(0));
        address b = router.createSession(SESSION2, address(0));
        vm.stopPrank();
        assertTrue(a != b);
    }

    function testCloseSession() public {
        vm.prank(controller);
        address session = router.createSession(SESSION, address(0));
        vm.expectEmit(true, true, false, true);
        emit SessionClosed(SESSION, session);
        vm.prank(controller);
        router.closeSession(SESSION);
        assertEq(router.sessionAddress(SESSION), address(0));
        assertEq(router.sessionIdOf(session), bytes32(0));
    }

    function testCloseSessionOnlyController() public {
        vm.prank(controller);
        router.createSession(SESSION, address(0));
        vm.prank(alice);
        vm.expectRevert(DepositRouter.NotController.selector);
        router.closeSession(SESSION);
    }

    function testCloseUnknownSessionReverts() public {
        vm.prank(controller);
        vm.expectRevert(DepositRouter.UnknownSession.selector);
        router.closeSession(SESSION);
    }

    function testPauseBlocksCreateSession() public {
        router.pause();
        vm.prank(controller);
        vm.expectRevert();
        router.createSession(SESSION, address(0));
        router.unpause();
        vm.prank(controller);
        router.createSession(SESSION, address(0));
    }

    function testSettersOnlyOwner() public {
        vm.startPrank(alice);
        vm.expectRevert();
        router.setTreasury(alice);
        vm.expectRevert();
        router.setSessionImplementation(alice);
        vm.expectRevert();
        router.setGameController(alice);
        vm.stopPrank();
    }

    function testSetTreasuryRejectsZero() public {
        vm.expectRevert(DepositRouter.ZeroAddress.selector);
        router.setTreasury(address(0));
    }

    function testOnlyOwnerCanUpgrade() public {
        DepositRouterV2 v2 = new DepositRouterV2();
        vm.prank(alice);
        vm.expectRevert();
        router.upgradeToAndCall(address(v2), "");
    }

    function testUpgradePreservesSessions() public {
        vm.prank(controller);
        address session = router.createSession(SESSION, address(0));

        DepositRouterV2 v2 = new DepositRouterV2();
        router.upgradeToAndCall(address(v2), "");

        assertEq(DepositRouterV2(payable(address(router))).version(), 2);
        assertEq(router.sessionAddress(SESSION), session);
        assertEq(router.sessionIdOf(session), SESSION);
        assertEq(router.treasury(), address(treasury));
    }
}
