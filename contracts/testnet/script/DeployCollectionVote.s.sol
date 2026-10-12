// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {CollectionVote} from "../../economy/CollectionVote.sol";

/// @notice Deploys the CollectionVote governance contract.
///
/// Env:
///   PRIVATE_KEY          (required) Deployer private key
///   FRENS_TOKEN_ADDRESS  (optional, defaults to Base FRENS: 0x1A96226727a1D0a46334b3A4b3878B32B7659ba3)
///   MIN_HOLDING_FRENS    (optional, defaults to 100,000 FRENS)
///
/// Usage:
///   forge script contracts/testnet/script/DeployCollectionVote.s.sol:DeployCollectionVote \
///     --rpc-url $env:BASE_RPC --broadcast --verify
contract DeployCollectionVote is Script {
    address public constant DEFAULT_FRENS = 0x1A96226727a1D0a46334b3A4b3878B32B7659ba3;
    uint256 public constant DEFAULT_MIN_HOLDING = 100_000 * 10**18;

    function run() external returns (CollectionVote voteContract) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        address frensToken = vm.envOr("FRENS_TOKEN_ADDRESS", DEFAULT_FRENS);
        uint256 minHolding = vm.envOr("MIN_HOLDING_FRENS", DEFAULT_MIN_HOLDING);

        vm.startBroadcast(deployerPrivateKey);

        voteContract = new CollectionVote(frensToken, minHolding);

        vm.stopBroadcast();

        console2.log("CollectionVote deployed successfully!");
        console2.log("Deployer:", deployer);
        console2.log("CollectionVote Address:", address(voteContract));
        console2.log("FRENS Token Address:", frensToken);
        console2.log("Min Holding Threshold:", minHolding);
        console2.log("Initial Burn Multiplier:", voteContract.burnMultiplier());
        console2.log("Permanent Boost BPS:", voteContract.permanentBoostBps());
    }
}
