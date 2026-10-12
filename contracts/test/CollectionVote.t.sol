// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CollectionVote} from "../economy/CollectionVote.sol";
import {TestFRENS} from "../testnet/TestFRENS.sol";

contract CollectionVoteTest is Test {
    CollectionVote internal voteContract;
    TestFRENS internal frensToken;

    address internal owner = address(this);
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal charlie = makeAddr("charlie");
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 internal constant MIN_HOLDING = 100_000 * 10**18; // 100k FRENS

    function setUp() public {
        frensToken = new TestFRENS(owner);
        voteContract = new CollectionVote(address(frensToken), MIN_HOLDING);

        // Fund test accounts
        frensToken.mint(alice, 2_000_000 * 10**18); // 2M FRENS
        frensToken.mint(bob, 1_000_000 * 10**18);   // 1M FRENS
        frensToken.mint(charlie, 50_000 * 10**18);   // 50k FRENS (below threshold)
    }

    function testInitialState() public view {
        assertEq(address(voteContract.frensToken()), address(frensToken));
        assertEq(voteContract.burnMultiplier(), 5);
        assertEq(voteContract.permanentBoostBps(), 1000); // 10% per 1M burned
        assertEq(voteContract.minHoldingThreshold(), MIN_HOLDING);
    }

    function testCreateProposal() public {
        uint256 id = voteContract.createProposal(
            "Hood Turtles",
            CollectionVote.CollectionSource.BankrX,
            "https://x.com/bankrbot/status/example",
            CollectionVote.ComplexityTier.Tier2Modular,
            3 days
        );

        assertEq(id, 1);
        (CollectionVote.Proposal memory p, bool isActive, uint256 timeRemaining) = voteContract.getProposal(1);
        assertEq(p.collectionName, "Hood Turtles");
        assertTrue(isActive);
        assertGt(timeRemaining, 2 days);
    }

    function testPermanentBoostOnFutureBallots() public {
        // Proposal 1: Alice burns 1,000,000 FRENS (earning +10% permanent boost)
        uint256 p1 = voteContract.createProposal(
            "Ballot 1",
            CollectionVote.CollectionSource.BankrX,
            "https://x.com",
            CollectionVote.ComplexityTier.Tier1Simple,
            1 days
        );

        uint256 burnAmt = 1_000_000 * 10**18;
        vm.startPrank(alice);
        frensToken.approve(address(voteContract), burnAmt);
        voteContract.castBurnVote(p1, burnAmt);
        vm.stopPrank();

        // Verify tokens burned and lifetime total tracked
        assertEq(frensToken.balanceOf(DEAD), burnAmt);
        assertEq(voteContract.userTotalBurned(alice), burnAmt);
        assertEq(frensToken.balanceOf(alice), 1_000_000 * 10**18); // Remaining balance

        // Verify permanent boost bonus helper
        // Base weight: 1M tokens. 10% bonus = +100k bonus weight!
        uint256 expectedBonus = 100_000 * 10**18;
        assertEq(voteContract.getPermanentBoostBonus(alice, 1_000_000 * 10**18), expectedBonus);

        // Proposal 2: Alice hold votes with remaining 1M balance
        // Base hold weight = 1M, plus +100k permanent boost = 1.1M total weight!
        uint256 p2 = voteContract.createProposal(
            "Ballot 2",
            CollectionVote.CollectionSource.OpenSea,
            "https://opensea.io",
            CollectionVote.ComplexityTier.Tier2Modular,
            3 days
        );

        vm.prank(alice);
        voteContract.castHoldVote(p2);

        (CollectionVote.Proposal memory prop2,,) = voteContract.getProposal(p2);
        assertEq(prop2.holdVotes, 1_100_000 * 10**18);
        assertEq(prop2.totalWeight, 1_100_000 * 10**18);
    }
}
