// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {TestFRENS} from "../TestFRENS.sol";

contract DeployTestFRENS is Script {
    function run() external returns (TestFRENS token) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);
        token = new TestFRENS(vm.addr(key));
        vm.stopBroadcast();
    }
}
