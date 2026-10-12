// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TinyFrensNFT} from "../../TinyFrensNFT.sol";
import {TinyFrensArt} from "../../TinyFrensArt.sol";
import {TinyFrensSprite} from "../../TinyFrensSprite.sol";

/// @notice Local fork measurement only. No broadcast and no private key.
/// Run with forge script contracts/testnet/script/MeasureRobotArt.s.sol --rpc-url https://sepolia.base.org
contract MeasureRobotArt is Script {
    function run() external {
        require(block.chainid == 84532, "Use Base Sepolia fork");
        address creator = address(0xBEEF);
        vm.startPrank(creator);
        TinyFrensArt art = new TinyFrensArt(address(new TinyFrensSprite()));
        TinyFrensNFT nft = new TinyFrensNFT(address(art));
        console2.log("Art runtime bytes", address(art).code.length);
        for (uint256 id = 1; id <= 6; id++) {
            uint256 beforeMint = gasleft();
            nft.mintToCreator(1, creator);
            uint256 mintGas = beforeMint - gasleft();
            console2.log("Token", id);
            console2.log("SVG bytes", bytes(nft.art(id)).length);
            uint256 storedBytes = bytes(nft.tokenURI(id)).length;
            require(storedBytes <= 13000, "Sample metadata exceeds 13 KB budget");
            require(mintGas <= 5000000, "Sample creator mint exceeds 5M execution gas budget");
            console2.log("Stored tokenURI bytes", storedBytes);
            console2.log("Mint execution gas", mintGas);
        }
        vm.stopPrank();
    }
}
