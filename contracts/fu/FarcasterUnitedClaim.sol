// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Farcaster United claim
/// @notice Lets each soulbound Network School Farcaster client VOTE NFT claim
///         exactly one F.U. NFT. The F.U. token uses the same token ID, creating
///         a directly auditable one-for-one relationship without pretending the
///         non-transferable VOTE can be moved into a vault.
contract FarcasterUnitedClaim is ERC721, Ownable2Step, ReentrancyGuard {
    IERC721 public immutable voteToken;
    uint256 public totalClaimed;
    bool public claimsPaused = true;
    bool public metadataFrozen;

    mapping(uint256 voteTokenId => bool) public claimed;

    string private _tokenBaseURI;

    event Claimed(address indexed claimant, uint256 indexed voteTokenId, uint256 indexed fuTokenId);
    event ClaimsPausedUpdated(bool paused);
    event BaseURIUpdated(string baseURI);
    event MetadataFrozen();

    error ZeroAddress();
    error ClaimsPaused();
    error AlreadyClaimed(uint256 tokenId);
    error NotVoteOwner(uint256 tokenId);
    error MetadataIsFrozen();

    constructor(address voteToken_, string memory initialBaseURI) ERC721("Farcaster United", "FU") Ownable(msg.sender) {
        if (voteToken_ == address(0)) revert ZeroAddress();
        voteToken = IERC721(voteToken_);
        _tokenBaseURI = initialBaseURI;
        emit BaseURIUpdated(initialBaseURI);
        emit ClaimsPausedUpdated(true);
    }

    /// @notice Claim the F.U. NFT matching a VOTE NFT currently owned by the caller.
    function claim(uint256 voteTokenId) external nonReentrant {
        if (claimsPaused) revert ClaimsPaused();
        if (claimed[voteTokenId]) revert AlreadyClaimed(voteTokenId);
        if (voteToken.ownerOf(voteTokenId) != msg.sender) revert NotVoteOwner(voteTokenId);

        claimed[voteTokenId] = true;
        unchecked {
            totalClaimed += 1;
        }
        _safeMint(msg.sender, voteTokenId);

        emit Claimed(msg.sender, voteTokenId, voteTokenId);
    }

    function setClaimsPaused(bool paused) external onlyOwner {
        claimsPaused = paused;
        emit ClaimsPausedUpdated(paused);
    }

    function setBaseURI(string calldata baseURI_) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        _tokenBaseURI = baseURI_;
        emit BaseURIUpdated(baseURI_);
    }

    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    function _baseURI() internal view override returns (string memory) {
        return _tokenBaseURI;
    }
}
