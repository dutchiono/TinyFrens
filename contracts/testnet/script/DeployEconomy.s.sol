// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Treasury} from "../../economy/Treasury.sol";
import {JackpotVault} from "../../economy/JackpotVault.sol";
import {DepositSession} from "../../economy/DepositSession.sol";
import {DepositRouter} from "../../economy/DepositRouter.sol";

/// @notice Deploys the TinyFrens economy: UUPS implementation + ERC1967 proxy for
///         Treasury, JackpotVault, and DepositRouter, plus the DepositSession
///         minimal-proxy implementation the router clones per deposit session.
///
/// Env:
///   PRIVATE_KEY      (required) deployer key
///   TREASURY_OWNER   (optional, default deployer) proxy admin / owner
///   GAME_CONTROLLER  (optional, default deployer) address allowed to move funds / open sessions
///
/// Usage (Base Sepolia):
///   forge script contracts/testnet/script/DeployEconomy.s.sol:DeployEconomy \
///     --rpc-url $env:BASE_SEPOLIA_RPC --broadcast --verify
contract DeployEconomy is Script {
    function run() external returns (Treasury treasury, JackpotVault vault, DepositRouter router) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        address owner = vm.envOr("TREASURY_OWNER", deployer);
        address controller = vm.envOr("GAME_CONTROLLER", deployer);

        vm.startBroadcast(key);

        Treasury treasuryImpl = new Treasury();
        treasury = Treasury(
            payable(
                address(
                    new ERC1967Proxy(
                        address(treasuryImpl), abi.encodeCall(Treasury.initialize, (owner, controller))
                    )
                )
            )
        );

        JackpotVault vaultImpl = new JackpotVault();
        vault = JackpotVault(
            payable(
                address(
                    new ERC1967Proxy(
                        address(vaultImpl), abi.encodeCall(JackpotVault.initialize, (owner, controller))
                    )
                )
            )
        );

        DepositSession sessionImpl = new DepositSession();
        DepositRouter routerImpl = new DepositRouter();
        router = DepositRouter(
            payable(
                address(
                    new ERC1967Proxy(
                        address(routerImpl),
                        abi.encodeCall(
                            DepositRouter.initialize, (owner, controller, address(treasury), address(sessionImpl))
                        )
                    )
                )
            )
        );

        vm.stopBroadcast();

        console2.log("deployer", deployer);
        console2.log("owner", owner);
        console2.log("controller", controller);
        console2.log("treasuryImpl", address(treasuryImpl));
        console2.log("treasuryProxy", address(treasury));
        console2.log("vaultImpl", address(vaultImpl));
        console2.log("vaultProxy", address(vault));
        console2.log("sessionImpl", address(sessionImpl));
        console2.log("routerImpl", address(routerImpl));
        console2.log("routerProxy", address(router));
    }
}
