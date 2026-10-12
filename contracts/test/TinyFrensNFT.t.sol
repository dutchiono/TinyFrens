// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {TinyFrensNFT} from "../TinyFrensNFT.sol";
import {TinyFrensArt} from "../TinyFrensArt.sol";
import {TinyFrensSprite} from "../TinyFrensSprite.sol";
import {TestFRENS} from "../testnet/TestFRENS.sol";
import {LibString} from "solady/utils/LibString.sol";
import {Base64} from "solady/utils/Base64.sol";

contract MockNetProtocol {
    bool public fail;
    function setFail(bool value) external { fail = value; }
    function sendMessage(string calldata, string calldata, bytes calldata) external view {
        require(!fail, "Net message rejected");
    }
    function sendMessageViaApp(address, string calldata, string calldata, bytes calldata) external view {
        require(!fail, "Net message rejected");
    }
}

contract MockNetStorage {
    mapping(bytes32 => mapping(address => bytes)) private stored;
    bool public fail;
    function setFail(bool value) external { fail = value; }
    function put(bytes32 key, string calldata, bytes calldata data) external {
        require(!fail, "Net Storage write rejected");
        stored[key][msg.sender] = data;
    }
    function get(bytes32 key, address operator) external view returns (string memory, bytes memory) {
        require(!fail, "Net Storage read rejected");
        return ("", stored[key][operator]);
    }
}

contract TinyFrensNFTTest is Test {
    using LibString for string;
    TinyFrensNFT internal nft;
    TestFRENS internal token;
    address internal constant NET_ADDRESS = 0x00000000B24D62781dB359b07880a105cD0b64e6;
    address internal constant NET_STORAGE_ADDRESS = 0x00000000DB40fcB9f4466330982372e27Fd7Bbf5;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        vm.etch(NET_ADDRESS, address(new MockNetProtocol()).code);
        vm.etch(NET_STORAGE_ADDRESS, address(new MockNetStorage()).code);
        token = new TestFRENS(address(this));
        TinyFrensSprite sprite = new TinyFrensSprite();
        TinyFrensArt art = new TinyFrensArt(address(sprite));
        nft = new TinyFrensNFT(address(art));
        nft.setFrensToken(address(token));
        vm.deal(alice, 1 ether);
        token.mint(alice, 1_000_000_000 * 10**18);
        token.mint(bob, 1_000_000_000 * 10**18);
    }

    function testDeploymentRequiresNet() public {
        address renderer = address(nft.artRenderer());
        vm.etch(NET_ADDRESS, "");
        vm.expectRevert();
        new TinyFrensNFT(renderer);
    }

    function testDeploymentRequiresNetStorage() public {
        address renderer = address(nft.artRenderer());
        vm.etch(NET_STORAGE_ADDRESS, "");
        vm.expectRevert(TinyFrensNFT.NetStorageUnavailable.selector);
        new TinyFrensNFT(renderer);
    }

    function testNetMessageFailureRevertsMint() public {
        MockNetProtocol(NET_ADDRESS).setFail(true);
        vm.prank(alice);
        vm.expectRevert();
        nft.mint{value: 0.001 ether}(1);
        assertEq(nft.totalSupply(), 0);
    }

    function testNetStorageFailureRevertsMint() public {
        MockNetStorage(NET_STORAGE_ADDRESS).setFail(true);
        vm.prank(alice);
        vm.expectRevert();
        nft.mint{value: 0.001 ether}(1);
        assertEq(nft.totalSupply(), 0);
    }

    function testStoredMetadataIsRequired() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);
        MockNetStorage(NET_STORAGE_ADDRESS).setFail(true);
        vm.expectRevert();
        nft.tokenURI(1);
    }

    function testMintPriceIsEth() public {
        assertEq(nft.price(), 0.001 ether);
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);
        assertEq(nft.ownerOf(1), alice);
    }

    function testRobotsEditionIdentityMatchesStoredMetadata() public {
        assertEq(nft.name(), "TinyFrens: Robots v1");
        assertEq(nft.symbol(), "TFROB1");
        assertEq(nft.COLLECTION_ID(), "tinyfrens-robots-v1");
        assertEq(nft.COLLECTION_VERSION(), 1);
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);
        assertEq(nft.tokenName(1), "TinyFrens Robot v1 #1");
        string memory json = string(Base64.decode(nft.tokenURI(1).slice(29)));
        assertTrue(json.contains('"name":"TinyFrens Robot v1 #1"'));
        assertTrue(json.contains('"trait_type":"Series","value":"Robots"'));
        assertTrue(json.contains('"trait_type":"Edition","value":"v1"'));
        string memory collection = string(Base64.decode(nft.contractURI().slice(29)));
        assertTrue(collection.contains('"name":"TinyFrens: Robots v1"'));
        assertTrue(collection.contains(nft.COLLECTION_DESCRIPTION()));
    }

    function testRobotOnlyArtHasWalkFrames() public {
        vm.prank(alice);
        nft.mint{value: 0.004 ether}(4);

        for (uint256 tokenId = 1; tokenId <= 4; tokenId++) {
            string memory artwork = nft.art(tokenId);
            assertTrue(artwork.contains('data-species="0"'));
            assertTrue(artwork.contains('shape-rendering="crispEdges"'));
            assertTrue(artwork.contains('class="foot-a"'));
            assertTrue(artwork.contains('class="foot-b"'));
            assertTrue(artwork.contains('class="arm-a"'));
            assertTrue(artwork.contains('class="arm-b"'));
            assertTrue(artwork.contains("@keyframes step-a"));
            assertTrue(artwork.contains("@keyframes arm-a"));
            assertTrue(artwork.contains("<rect"));
        }
    }

    function testOwnerCanRenameAndEvolve() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        (address operator, bytes32 key, string memory text) = nft.netStoragePointer(1);
        assertEq(operator, address(nft));
        assertTrue(key != bytes32(0));
        assertEq(text, "TinyFrens: Robots v1 tokenURI #1");

        vm.prank(alice);
        nft.rename(1, "Lil Button");
        assertEq(nft.tokenName(1), "Lil Button");

        vm.prank(alice);
        nft.evolve(1);
        assertEq(nft.evolutionStage(1), 1);
    }

    function testOnlyOwnerCanRenameOrEvolve() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        vm.prank(bob);
        vm.expectRevert(TinyFrensNFT.NotTokenOwner.selector);
        nft.rename(1, "Sneaky");

        vm.prank(bob);
        vm.expectRevert(TinyFrensNFT.NotTokenOwner.selector);
        nft.evolve(1);
    }

    function testRenameRejectsUnsafeJsonCharacters() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        vm.prank(alice);
        vm.expectRevert(TinyFrensNFT.InvalidPetName.selector);
        nft.rename(1, 'Bad " JSON');
    }

    function testEvolutionCapsAtStageThree() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        vm.startPrank(alice);
        nft.evolve(1);
        nft.evolve(1);
        nft.evolve(1);
        vm.expectRevert(TinyFrensNFT.MaxEvolutionReached.selector);
        nft.evolve(1);
        vm.stopPrank();
    }

    function testMintWithVaultCollateral() public {
        uint256 frensRequired = nft.frensPerVaultMint();
        vm.startPrank(alice);
        token.approve(address(nft), frensRequired);
        nft.mintWithVault(1, frensRequired);
        vm.stopPrank();

        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.lockedFrens(1), frensRequired);
        // Storage is refreshed after vault collateral is assigned.
        assertEq(bytes(nft.tokenURI(1)).length > 0, true);
        assertEq(token.balanceOf(address(nft)), frensRequired);

        string memory uri = nft.tokenURI(1);
        assertTrue(uri.contains("data:application/json"));
    }

    function testUnwrapBurnsAndReturnsFrens() public {
        uint256 frensRequired = nft.frensPerVaultMint();
        vm.startPrank(alice);
        token.approve(address(nft), frensRequired);
        nft.mintWithVault(1, frensRequired);

        uint256 balBefore = token.balanceOf(alice);
        nft.unwrap(1);
        vm.stopPrank();

        assertEq(token.balanceOf(alice), balBefore + frensRequired);
        assertEq(nft.lockedFrens(1), 0);
        assertEq(token.balanceOf(address(nft)), 0);

        // Token #1 is burned
        vm.expectRevert();
        nft.ownerOf(1);
    }

    function testOnlyOwnerCanUnwrap() public {
        uint256 frensRequired = nft.frensPerVaultMint();
        vm.startPrank(alice);
        token.approve(address(nft), frensRequired);
        nft.mintWithVault(1, frensRequired);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert(TinyFrensNFT.NotTokenOwner.selector);
        nft.unwrap(1);
    }

    function testCannotUnwrapStandardEthNft() public {
        vm.prank(alice);
        nft.mint{value: 0.001 ether}(1);

        vm.prank(alice);
        vm.expectRevert(TinyFrensNFT.NoLockedFrens.selector);
        nft.unwrap(1);
    }
}
