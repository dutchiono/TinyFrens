// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TinyFrensNFT} from "../../TinyFrensNFT.sol";

contract PackageCreate2Factory {
    function deploy(bytes memory initcode) external returns (address deployed) {
        assembly { deployed := create2(0, add(initcode, 32), mload(initcode), 0) }
        require(deployed != address(0), "CREATE2 failed");
    }
}

/// @notice Local Base fork only: reads the exact hosted package. Never broadcasts.
/// This tests CREATE2 semantics, not Bankr's unavailable authenticated tool/factory.
contract RehearseBankrPackage is Script {
    function code(string memory name) internal view returns (bytes memory) {
        bytes memory text = bytes(vm.readFile(string.concat(
            "web/robots-launch/", name, ".bytecode.txt"
        )));
        uint256 length = text.length;
        while (length > 0 && (text[length - 1] == 0x0a || text[length - 1] == 0x0d)) --length;
        assembly { mstore(text, length) }
        return vm.parseBytes(string(text));
    }

    function run() external {
        require(block.chainid == 8453, "Use a Base fork");
        address creator = address(0xBEEF);
        vm.deal(creator, 1 ether);
        PackageCreate2Factory factory = new PackageCreate2Factory();
        address sprite = factory.deploy(code("TinyFrensSprite"));
        address art = factory.deploy(abi.encodePacked(code("TinyFrensArt"), abi.encode(sprite)));
        TinyFrensNFT nft = TinyFrensNFT(factory.deploy(abi.encodePacked(
            code("TinyFrensNFT"), abi.encode(art, creator)
        )));
        require(nft.creator() == creator, "Factory must not become creator");
        vm.startPrank(creator);
        nft.mintToCreator(1, creator);
        nft.mint{value: 0.001 ether}(1);
        vm.stopPrank();
        require(nft.ownerOf(1) == creator && nft.ownerOf(2) == creator, "Wrong mint owner");
        require(bytes(nft.tokenURI(2)).length > 10000, "Missing stored metadata");
        uint256 balance = creator.balance;
        nft.withdraw();
        require(creator.balance == balance + 0.001 ether, "Wrong revenue recipient");
        console2.log("Packaged CREATE2 deployments, reserve, paid mint, Net Storage and creator revenue passed");
        console2.log("Fork block", block.number);
        console2.log("NFT runtime bytes", address(nft).code.length);
        console2.log("Stored tokenURI bytes", bytes(nft.tokenURI(2)).length);
    }
}
