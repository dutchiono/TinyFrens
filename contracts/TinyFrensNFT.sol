// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { NetIntegratedERC721A } from "./NetIntegratedERC721A.sol";
import { LibString } from "solady/utils/LibString.sol";
import { Base64 } from "solady/utils/Base64.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ITinyFrensArt, Traits } from "./TinyFrensArt.sol";

interface INetStorage {
    function put(bytes32 key, string calldata text, bytes calldata data) external;
    function get(bytes32 key, address operator) external view returns (string memory, bytes memory);
}

/// @title TinyFrensNFT
/// @notice Curated on-chain companion collection with FRENS Piggybank Vault backing.
///         Auto-posts mints, transfers, and burns to Net Protocol.
contract TinyFrensNFT is NetIntegratedERC721A {
    using LibString for uint256;
    using SafeERC20 for IERC20;

    ITinyFrensArt public immutable artRenderer;
    IERC20 public frensToken;
    uint256 public frensPerVaultMint;
    mapping(uint256 => uint256) public lockedFrens;

    mapping(uint256 => string) private _customName;
    mapping(uint256 => uint8) private _evolution;

    INetStorage public constant NET_STORAGE = INetStorage(0x00000000DB40fcB9f4466330982372e27Fd7Bbf5);

    event TinyFrenRenamed(uint256 indexed tokenId, string name);
    event TinyFrenEvolved(uint256 indexed tokenId, uint8 stage);
    event TinyFrenNetStorageSynced(uint256 indexed tokenId, address indexed operator, bytes32 indexed key);
    event TinyFrenVaultMinted(uint256 indexed tokenId, address indexed owner, uint256 frensLocked);
    event TinyFrenUnwrapped(uint256 indexed tokenId, address indexed owner, uint256 frensRedeemed);
    event FrensPerVaultMintUpdated(uint256 frensPerVaultMint);
    event FrensTokenUpdated(address frensToken);

    error InvalidPetName();
    error MaxEvolutionReached();
    error NotTokenOwner();
    error NoLockedFrens();
    error InsufficientFrensDeposit();
    error ZeroAddress();
    error NetStorageUnavailable();
    error NetStorageMetadataMissing();

    constructor(address artRenderer_)
        NetIntegratedERC721A(
            "TinyFrens", // name
            "FREN",      // symbol
            0.001 ether, // price (0.001 ETH)
            2664,        // maxSupply
            20,          // maxMintsPerWallet
            20           // creatorReserve
        )
    {
        require(artRenderer_.code.length > 0, "Missing art renderer");
        if (address(NET_STORAGE).code.length == 0) revert NetStorageUnavailable();
        artRenderer = ITinyFrensArt(artRenderer_);
        frensToken = IERC20(0x1A96226727a1D0a46334b3A4b3878B32B7659ba3);
        frensPerVaultMint = 47_619_047 * 10**18; // ~0.002 ETH worth of FRENS
    }

    function setFrensToken(address newToken) external onlyDeployer {
        if (newToken == address(0)) revert ZeroAddress();
        frensToken = IERC20(newToken);
        emit FrensTokenUpdated(newToken);
    }

    function setFrensPerVaultMint(uint256 newAmount) external onlyDeployer {
        frensPerVaultMint = newAmount;
        emit FrensPerVaultMintUpdated(newAmount);
    }

    /// @notice Mint Fren Vault loaded with FRENS tokens (0.002 ETH worth of FRENS)
    function mintWithVault(uint256 amount, uint256 frensPerToken) external {
        if (address(frensToken) == address(0)) revert ZeroAddress();
        if (frensPerVaultMint != 0 && frensPerToken < frensPerVaultMint) revert InsufficientFrensDeposit();
        if (
            maxMintsPerWallet != 0 &&
            _numberMinted(msg.sender) + amount > maxMintsPerWallet
        ) revert MaxMintsPerWalletReached();

        uint256 totalFrens = amount * frensPerToken;
        frensToken.safeTransferFrom(msg.sender, address(this), totalFrens);

        uint256 startTokenId = _nextTokenId();
        _mintSeeded(msg.sender, amount);

        unchecked {
            for (uint256 i; i < amount; ++i) {
                uint256 tid = startTokenId + i;
                lockedFrens[tid] = frensPerToken;
                _syncNetStorage(tid);
                emit TinyFrenVaultMinted(tid, msg.sender, frensPerToken);
            }
        }
    }

    /// @notice Deposit additional FRENS collateral into an existing Fren NFT
    function depositFrens(uint256 tokenId, uint256 amount) external {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        if (amount == 0) revert InsufficientFrensDeposit();
        frensToken.safeTransferFrom(msg.sender, address(this), amount);
        lockedFrens[tokenId] += amount;
        _syncNetStorage(tokenId);
        emit TinyFrenVaultMinted(tokenId, ownerOf(tokenId), lockedFrens[tokenId]);
    }

    /// @notice Unwrap Fren Vault: burns NFT and returns 100% of locked FRENS to the owner
    function unwrap(uint256 tokenId) external {
        _requireTokenOwner(tokenId);
        uint256 locked = lockedFrens[tokenId];
        if (locked == 0) revert NoLockedFrens();

        delete lockedFrens[tokenId];
        _burn(tokenId);
        frensToken.safeTransfer(msg.sender, locked);

        emit TinyFrenUnwrapped(tokenId, msg.sender, locked);
    }

    function tokenName(uint256 tokenId) public view returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        string memory custom = _customName[tokenId];
        if (bytes(custom).length != 0) return custom;
        return string.concat("TinyFren #", tokenId.toString());
    }

    function evolutionStage(uint256 tokenId) public view returns (uint8) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        return _evolution[tokenId];
    }

    function rename(uint256 tokenId, string calldata newName) external {
        _requireTokenOwner(tokenId);
        bytes calldata raw = bytes(newName);
        if (raw.length == 0 || raw.length > 32) revert InvalidPetName();
        for (uint256 i; i < raw.length; ++i) {
            bytes1 c = raw[i];
            bool ok = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)
                || c == 0x20 || c == 0x21 || c == 0x23 || c == 0x2D || c == 0x2E || c == 0x3F || c == 0x5F;
            if (!ok) revert InvalidPetName();
        }
        _customName[tokenId] = newName;
        _syncNetStorage(tokenId);
        emit TinyFrenRenamed(tokenId, newName);
    }

    function evolve(uint256 tokenId) external {
        _requireTokenOwner(tokenId);
        uint8 stage = _evolution[tokenId];
        if (stage >= 3) revert MaxEvolutionReached();
        unchecked {
            stage += 1;
        }
        _evolution[tokenId] = stage;
        _syncNetStorage(tokenId);
        emit TinyFrenEvolved(tokenId, stage);
    }

    function netStoragePointer(uint256 tokenId)
        external
        view
        returns (address operator, bytes32 key, string memory text)
    {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        return (address(this), _netStorageKey(tokenId), _netStorageText(tokenId));
    }

    function _requireTokenOwner(uint256 tokenId) internal view {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
    }

    function _afterMintSeeded(uint256 startTokenId, uint256 amount) internal override {
        unchecked {
            for (uint256 i; i < amount; ++i) {
                _syncNetStorage(startTokenId + i);
            }
        }
    }

    function _netStorageKey(uint256 tokenId) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("tinyfrens.tokenURI", address(this), tokenId));
    }

    function _netStorageText(uint256 tokenId) internal pure returns (string memory) {
        return string.concat("TinyFrens tokenURI #", tokenId.toString());
    }

    function _syncNetStorage(uint256 tokenId) internal {
        bytes32 key = _netStorageKey(tokenId);
        NET_STORAGE.put(key, _netStorageText(tokenId), bytes(_generatedTokenURI(tokenId)));
        emit TinyFrenNetStorageSynced(tokenId, address(this), key);
    }

    function _traits(uint256 tokenId) internal pure returns (Traits memory t) {
        // BNKR launch is a focused robot-only collection across three 888-token eras.
        t.species = 0;

        t.era = uint8((tokenId - 1) / 888);
        uint256 cohortIndex = (tokenId - 1) % 888;
        uint256 artIndex = (cohortIndex * 197 + 17) % 4608;
        t.palette = uint8(artIndex % 8);
        uint256 combination = artIndex / 8;
        t.expr = uint8(combination % 4);
        t.acc = uint8((combination / 4) % 6);
        t.habitat = uint8((combination / 24) % 6);
        t.motion = uint8((combination / 144) % 4);
    }

    function _speciesName(uint8) internal pure returns (string memory) {
        return "Robot";
    }

    function _paletteData(uint8 p) internal pure returns (
        string memory body,
        string memory dark,
        string memory bg,
        string memory name,
        string memory tier
    ) {
        if (p == 0) return ("#a474f1", "#302048", "#17142a", "Lavender Dream", "Classic");
        if (p == 1) return ("#66c7d2", "#183d4d", "#102c38", "Cyber Neon", "Classic");
        if (p == 2) return ("#ffb95e", "#623b29", "#382a38", "Sunny Amber", "Classic");
        if (p == 3) return ("#82eba1", "#24533f", "#193c3a", "Mint Meadow", "Classic");
        if (p == 4) return ("#ff82a7", "#632b48", "#3b213b", "Bubblegum", "Classic");
        if (p == 5) return ("#4d96ff", "#263a6a", "#182d50", "Electric Blue", "Classic");
        if (p == 6) return ("#76638e", "#241d38", "#211c39", "Midnight Obsidian", "Rare");
        return ("#ffd700", "#6c421c", "#2d2238", "24K Solid Gold", "Legendary");
    }

    function _exprName(uint8 e) internal pure returns (string memory) {
        if (e == 0) return "Classic Happy";
        if (e == 1) return "Playful Wink";
        if (e == 2) return "Cool Shades";
        return "Star Eyes";
    }

    function _accName(uint8 a) internal pure returns (string memory) {
        if (a == 0) return "None";
        if (a == 1) return "Party Hat";
        if (a == 2) return "Royal Crown";
        if (a == 3) return "Angel Halo";
        if (a == 4) return "Dapper Bow Tie";
        return "Mystic Orb";
    }

    function _eraName(uint8 e) internal pure returns (string memory) {
        if (e == 0) return "Pocket Genesis";
        if (e == 1) return "Street Wanderers";
        return "Dream Garden";
    }

    function _habitatName(uint8 h) internal pure returns (string memory) {
        if (h == 0) return "Moonlit Plaza";
        if (h == 1) return "Neon Crosswalk";
        if (h == 2) return "Snack Garden";
        if (h == 3) return "Cloud Room";
        if (h == 4) return "Arcade Alley";
        return "Tiny Meadow";
    }

    function _motionName(uint8 m) internal pure returns (string memory) {
        if (m == 0) return "Happy Walk";
        if (m == 1) return "Bouncy Strut";
        if (m == 2) return "Sleepy Drift";
        return "Excited Wiggle";
    }

    /// @notice 64x64 grid-drawn animated companion.
    function art(uint256 tokenId) public view returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();
        return artRenderer.render(_traits(tokenId), _evolution[tokenId]);
    }

    function _attributes(uint256 tokenId) internal view returns (string memory) {
        Traits memory t = _traits(tokenId);
        (, , , string memory palName, string memory tier) = _paletteData(t.palette);

        uint256 locked = lockedFrens[tokenId];
        string memory vaultAttrs = "";
        if (locked > 0) {
            vaultAttrs = string.concat(
                ',{"trait_type":"Vault Backed","value":"FRENS Piggybank"},{"trait_type":"Locked FRENS (Wei)","value":"',
                locked.toString(),
                '"}'
            );
        }

        return string.concat(
            '[{"trait_type":"Species","value":"', _speciesName(t.species),
            '"},{"trait_type":"Palette","value":"', palName,
            '"},{"trait_type":"Rarity Tier","value":"', tier,
            '"},{"trait_type":"Expression","value":"', _exprName(t.expr),
            '"},{"trait_type":"Accessory","value":"', _accName(t.acc),
            '"},{"trait_type":"Era","value":"', _eraName(t.era),
            '"},{"trait_type":"Habitat","value":"', _habitatName(t.habitat),
            '"},{"trait_type":"Motion","value":"', _motionName(t.motion),
            '"},{"trait_type":"Evolution","value":"Stage ', uint256(_evolution[tokenId]).toString(),
            '"}',
            vaultAttrs,
            ']'
        );
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();

        (, bytes memory data) = NET_STORAGE.get(_netStorageKey(tokenId), address(this));
        if (data.length == 0) revert NetStorageMetadataMissing();
        return string(data);
    }

    function _generatedTokenURI(uint256 tokenId) internal view returns (string memory) {
        string memory image = Base64.encode(bytes(art(tokenId)));
        string memory json = string.concat(
            '{"name":"', tokenName(tokenId),
            '","description":"TinyFrens 1:1 on-chain companion. A little company. A little chaos. Your tiny fren.",',
            '"image":"data:image/svg+xml;base64,', image, '",',
            '"attributes":', _attributes(tokenId),
            '}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }
}
