// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TinyFrensNFT} from "../../TinyFrensNFT.sol";
import {TinyFrensArt} from "../../TinyFrensArt.sol";
import {TinyFrensSprite} from "../../TinyFrensSprite.sol";

/// @notice Deploys the real TinyFrensNFT collection to a testnet (Base Sepolia).
///         100% on-chain generative art; tokenURI embeds SVG as a data URI, so it
///         renders in Blockscout — but not OpenSea (OpenSea does not index testnets).
///
/// Env:
///   PRIVATE_KEY (required) deployer key
///   MINT_CREATOR_RESERVE (optional, default 20) free mintToCreator tokens sent to
///                        the deployer so the testnet collection is non-empty.
///
/// Usage (Base Sepolia):
///   forge script contracts/testnet/script/DeployTinyFrensNFT.s.sol:DeployTinyFrensNFT \
///     --rpc-url $env:BASE_SEPOLIA_RPC --broadcast
contract DeployTinyFrensNFT is Script {
    function run() external returns (TinyFrensNFT nft) {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        uint256 mintCount = vm.envOr("MINT_CREATOR_RESERVE", uint256(20));

        // Validate the required Net infrastructure on the selected chain before broadcasting.
        require(block.chainid == 84532 || block.chainid == 46630 || block.chainid == 8453 || block.chainid == 4663, "Unsupported deployment chain");
        require(address(0x00000000B24D62781dB359b07880a105cD0b64e6).code.length > 0, "Net Protocol missing on chain");
        require(address(0x00000000DB40fcB9f4466330982372e27Fd7Bbf5).code.length > 0, "Net Storage missing on chain");
        vm.startBroadcast(key);
        TinyFrensSprite sprite = new TinyFrensSprite();
        TinyFrensArt art = new TinyFrensArt(address(sprite));
        nft = new TinyFrensNFT(address(art), deployer);
        address frensToken = vm.envOr("FRENS_TOKEN", address(0));
        if (frensToken != address(0)) {
            nft.setFrensToken(frensToken);
        }
        if (mintCount > 0) {
            nft.mintToCreator(mintCount, deployer);
        }
        vm.stopBroadcast();

        console2.log("nftAddress", address(nft));
        console2.log("artAddress", address(nft.artRenderer()));
        console2.log("spriteAddress", address(TinyFrensArt(address(nft.artRenderer())).spriteRenderer()));
        console2.log("nftMinted", mintCount);
    }
}
