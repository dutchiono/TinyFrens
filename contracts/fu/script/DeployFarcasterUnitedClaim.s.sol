// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {FarcasterUnitedClaim} from "../FarcasterUnitedClaim.sol";

/// @notice User-run Base mainnet deployment script. Agents must not broadcast it.
contract DeployFarcasterUnitedClaim is Script {
    uint256 internal constant BASE_CHAIN_ID = 8453;
    address internal constant BASE_VOTE_NFT = 0x4ecfEd276c566AeB49Da1f3A888E8Dbb7263028D;

    error UnsupportedChain(uint256 chainId);

    function run() external returns (FarcasterUnitedClaim claimContract) {
        if (block.chainid != BASE_CHAIN_ID) revert UnsupportedChain(block.chainid);

        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory baseURI = vm.envString("FU_BASE_URI");

        vm.startBroadcast(deployerPrivateKey);
        claimContract = new FarcasterUnitedClaim(BASE_VOTE_NFT, baseURI);
        vm.stopBroadcast();
    }
}
