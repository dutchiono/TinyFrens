// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {FarcasterUnitedClaim} from "../fu/FarcasterUnitedClaim.sol";

contract MockVoteNFT is ERC721 {
    constructor() ERC721("Network School Farcaster client", "VOTE") {}

    function mint(address to, uint256 tokenId) external {
        _safeMint(to, tokenId);
    }
}

contract ClaimingHolder is IERC721Receiver {
    FarcasterUnitedClaim internal immutable claimContract;

    constructor(FarcasterUnitedClaim claimContract_) {
        claimContract = claimContract_;
    }

    function claim(uint256 tokenId) external {
        claimContract.claim(tokenId);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract FarcasterUnitedClaimTest is Test {
    event Claimed(address indexed claimant, uint256 indexed voteTokenId, uint256 indexed fuTokenId);

    MockVoteNFT internal vote;
    FarcasterUnitedClaim internal claimContract;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vote = new MockVoteNFT();
        claimContract = new FarcasterUnitedClaim(address(vote), "ipfs://fu/");
        vote.mint(alice, 101);
        vote.mint(alice, 202);
    }

    function testDeploymentConfiguration() public view {
        assertEq(address(claimContract.voteToken()), address(vote));
        assertEq(claimContract.name(), "Farcaster United");
        assertEq(claimContract.symbol(), "FU");
        assertEq(claimContract.owner(), address(this));
        assertTrue(claimContract.claimsPaused());
        assertEq(claimContract.totalClaimed(), 0);
    }

    function testZeroVoteAddressReverts() public {
        vm.expectRevert(FarcasterUnitedClaim.ZeroAddress.selector);
        new FarcasterUnitedClaim(address(0), "ipfs://fu/");
    }

    function testClaimMintsMatchingTokenIdWithoutMovingVote() public {
        claimContract.setClaimsPaused(false);
        vm.expectEmit(true, true, true, true);
        emit Claimed(alice, 101, 101);
        vm.prank(alice);
        claimContract.claim(101);

        assertEq(vote.ownerOf(101), alice);
        assertEq(claimContract.ownerOf(101), alice);
        assertTrue(claimContract.claimed(101));
        assertEq(claimContract.totalClaimed(), 1);
        assertEq(claimContract.tokenURI(101), "ipfs://fu/101");
    }

    function testPausedByDefaultAndOwnerControlsPause() public {
        vm.prank(alice);
        vm.expectRevert(FarcasterUnitedClaim.ClaimsPaused.selector);
        claimContract.claim(101);

        vm.prank(alice);
        vm.expectRevert();
        claimContract.setClaimsPaused(false);

        claimContract.setClaimsPaused(false);
        assertFalse(claimContract.claimsPaused());
    }

    function testClaimRequiresCurrentOwner() public {
        claimContract.setClaimsPaused(false);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(FarcasterUnitedClaim.NotVoteOwner.selector, 101));
        claimContract.claim(101);
    }

    function testVoteTokenIdCanClaimOnlyOnce() public {
        claimContract.setClaimsPaused(false);
        vm.startPrank(alice);
        claimContract.claim(101);
        vm.expectRevert(abi.encodeWithSelector(FarcasterUnitedClaim.AlreadyClaimed.selector, 101));
        claimContract.claim(101);
        vm.stopPrank();
    }

    function testMultipleVoteTokensCanEachClaim() public {
        claimContract.setClaimsPaused(false);
        vm.startPrank(alice);
        claimContract.claim(101);
        claimContract.claim(202);
        vm.stopPrank();

        assertEq(claimContract.ownerOf(101), alice);
        assertEq(claimContract.ownerOf(202), alice);
        assertEq(claimContract.totalClaimed(), 2);
    }

    function testMetadataCanBeUpdatedThenPermanentlyFrozen() public {
        claimContract.setBaseURI("ipfs://final/");
        claimContract.freezeMetadata();
        assertTrue(claimContract.metadataFrozen());

        vm.expectRevert(FarcasterUnitedClaim.MetadataIsFrozen.selector);
        claimContract.setBaseURI("ipfs://changed/");
        vm.expectRevert(FarcasterUnitedClaim.MetadataIsFrozen.selector);
        claimContract.freezeMetadata();
    }

    function testContractVoteHolderCanClaimAndReceiveFU() public {
        ClaimingHolder holder = new ClaimingHolder(claimContract);
        vote.mint(address(holder), 303);
        claimContract.setClaimsPaused(false);

        holder.claim(303);

        assertEq(vote.ownerOf(303), address(holder));
        assertEq(claimContract.ownerOf(303), address(holder));
    }
}
