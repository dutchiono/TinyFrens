// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TinyFrensNFT} from "../../TinyFrensNFT.sol";
import {TinyFrensArt} from "../../TinyFrensArt.sol";
import {TinyFrensSprite} from "../../TinyFrensSprite.sol";

interface IBaseFeeOracle {
    function getL1FeeUpperBound(uint256 txSize) external view returns (uint256);
}

/// @notice Local fork measurement only. No broadcast and no private key.
/// Run with forge script contracts/testnet/script/MeasureRobotArt.s.sol --rpc-url https://mainnet.base.org
contract MeasureRobotArt is Script {
    function run() external {
        require(block.chainid == 84532 || block.chainid == 8453, "Use Base or Base Sepolia fork");
        address creator = address(0xBEEF);
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);
        uint256 beforeDeploy = gasleft();
        TinyFrensArt art = new TinyFrensArt(address(new TinyFrensSprite()));
        TinyFrensNFT nft = new TinyFrensNFT(address(art));
        console2.log("Chain ID", block.chainid);
        console2.log("Block number", block.number);
        console2.log("Combined deployment execution gas", beforeDeploy - gasleft());
        if (block.chainid == 8453) {
            IBaseFeeOracle oracle = IBaseFeeOracle(0x420000000000000000000000000000000000000F);
            console2.log("Base fee wei", block.basefee);
            console2.log("Mint L1 fee upper bound wei (200 signed bytes)", oracle.getL1FeeUpperBound(200));
            console2.log("Deployment L1 fee upper bound wei",
                oracle.getL1FeeUpperBound(type(TinyFrensSprite).creationCode.length + 200)
                + oracle.getL1FeeUpperBound(type(TinyFrensArt).creationCode.length + 200)
                + oracle.getL1FeeUpperBound(type(TinyFrensNFT).creationCode.length + 200));
        }
        console2.log("Art runtime bytes", address(art).code.length);
        for (uint256 id = 1; id <= 6; id++) {
            uint256 beforeMint = gasleft();
            nft.mint{value: 0.001 ether}(1);
            uint256 mintGas = beforeMint - gasleft();
            console2.log("Token", id);
            console2.log("SVG bytes", bytes(nft.art(id)).length);
            uint256 storedBytes = bytes(nft.tokenURI(id)).length;
            require(storedBytes <= 16000, "Sample metadata exceeds 16 KB budget");
            require(mintGas <= 6000000, "Sample public mint exceeds 6M execution gas budget");
            console2.log("Stored tokenURI bytes", storedBytes);
            console2.log("Mint execution gas", mintGas);
        }
        vm.stopPrank();
    }
}
