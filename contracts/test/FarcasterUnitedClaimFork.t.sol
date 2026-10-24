// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {FarcasterUnitedClaim} from "../fu/FarcasterUnitedClaim.sol";

contract FarcasterUnitedClaimForkTest is Test {
    uint256 internal constant BASE_CHAIN_ID = 8453;
    IERC721 internal constant BASE_VOTE = IERC721(0x4ecfEd276c566AeB49Da1f3A888E8Dbb7263028D);

    /// @dev Run with `--fork-url base`. The local-chain guard keeps ordinary
    ///      unit test runs independent of an external RPC.
    function testForkClaimsAgainstRealBaseVoteToken() public {
        if (block.chainid != BASE_CHAIN_ID) return;

        uint256 voteTokenId = 1;
        address holder = BASE_VOTE.ownerOf(voteTokenId);
        FarcasterUnitedClaim claimContract = new FarcasterUnitedClaim(address(BASE_VOTE), "ipfs://fu/");
        claimContract.setClaimsPaused(false);

        vm.prank(holder);
        claimContract.claim(voteTokenId);

        assertEq(BASE_VOTE.ownerOf(voteTokenId), holder);
        assertEq(claimContract.ownerOf(voteTokenId), holder);
        assertTrue(claimContract.claimed(voteTokenId));
        assertEq(claimContract.totalClaimed(), 1);
    }
}
