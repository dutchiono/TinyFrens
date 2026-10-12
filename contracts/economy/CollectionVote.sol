// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CollectionVote
/// @notice Community governance contract for TinyFrens holders to vote on which
///         NFT collections (Bankr drops on X, top OpenSea collections) to build next.
/// @dev Holding FRENS tokens grants baseline voting weight. Burning FRENS tokens
///      to address(0xdEaD) grants a heavily boosted "Frenzy" burn multiplier (5x).
contract CollectionVote is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    
    /// @notice The FRENS token contract on Base.
    IERC20 public immutable frensToken;

    /// @notice Multiplier granted to burned tokens (default: 5x).
    uint256 public burnMultiplier = 5;

    /// @notice Minimum FRENS token balance (in wei) required to create proposals or cast a hold vote.
    uint256 public minHoldingThreshold;

    /// @notice Counter for proposal IDs.
    uint256 public proposalCount;

    enum CollectionSource {
        BankrX,    // Launched by Bankr on X in recent days
        OpenSea    // Trending / top OpenSea collection
    }

    enum ComplexityTier {
        Tier1Simple,   // Simple 2D vector / pixel (quick animation rig)
        Tier2Modular,  // Modular traits & colorways
        Tier3Complex   // Complex animations, multi-rig accessories
    }

    struct Proposal {
        uint256 id;
        string collectionName;
        CollectionSource source;
        string sourceUrl;
        ComplexityTier complexity;
        uint256 startTime;
        uint256 endTime;
        uint256 holdVotes;       // Unburnt holder vote weight
        uint256 rawBurnedAmount; // Exact FRENS tokens burned
        uint256 totalWeight;     // holdVotes + (rawBurnedAmount * burnMultiplier)
        bool exists;
    }

    /// @notice Ballot proposal mapping: proposalId => Proposal
    mapping(uint256 => Proposal) public proposals;

    /// @notice Prevents duplicate hold-voting per wallet per ballot: proposalId => voter => hasVoted
    mapping(uint256 => mapping(address => bool)) public hasHoldVoted;

    /// @notice Tracks hold votes cast by a specific voter: proposalId => voter => voteWeight
    mapping(uint256 => mapping(address => uint256)) public voterHoldVotes;

    /// @notice Tracks cumulative burned tokens by a voter on a proposal: proposalId => voter => burnedAmount
    mapping(uint256 => mapping(address => uint256)) public voterBurnedAmount;

    /// @notice Lifetime cumulative tokens burned by a user across all ballots.
    mapping(address => uint256) public userTotalBurned;

    /// @notice Permanent boost in basis points per unit of lifetime burned tokens.
    /// @dev Default 1000 bps (10%) permanent boost per 1,000,000 FRENS burned.
    uint256 public permanentBoostBps = 1000; // 10%
    uint256 public constant PERMANENT_BOOST_DENOMINATOR = 10000;
    uint256 public constant PERMANENT_BOOST_UNIT = 1_000_000 * 10**18; // 1M FRENS unit

    event ProposalCreated(
        uint256 indexed proposalId,
        string collectionName,
        CollectionSource source,
        ComplexityTier complexity,
        uint256 startTime,
        uint256 endTime
    );

    event HoldVoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        uint256 baseWeight,
        uint256 permanentBonusWeight,
        uint256 totalCastWeight
    );

    event BurnVoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        uint256 burnedAmount,
        uint256 instantAddedWeight,
        uint256 lifetimeTotalBurned
    );

    event BurnMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier);
    event PermanentBoostBpsUpdated(uint256 oldBps, uint256 newBps);
    event MinHoldingThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    error ZeroAddress();
    error BelowThreshold(uint256 currentBalance, uint256 requiredThreshold);
    error ProposalNotFound(uint256 proposalId);
    error VotingNotActive(uint256 proposalId, uint256 currentTime, uint256 startTime, uint256 endTime);
    error AlreadyHoldVoted(uint256 proposalId, address voter);
    error InvalidDuration(uint256 duration);
    error ZeroBurnAmount();
    error InvalidMultiplier();

    /// @param frensToken_ The address of the FRENS token (e.g. 0x1A96226727a1D0a46334b3A4b3878B32B7659ba3)
    /// @param minHoldingThreshold_ Minimum FRENS required to participate (e.g. 100,000 * 10^18)
    constructor(address frensToken_, uint256 minHoldingThreshold_) Ownable(msg.sender) {
        if (frensToken_ == address(0)) revert ZeroAddress();
        frensToken = IERC20(frensToken_);
        minHoldingThreshold = minHoldingThreshold_;
    }

    /// @notice Create a new collection vote ballot.
    /// @param collectionName Name of the NFT collection (e.g. "Hood Turtles", "Milady")
    /// @param source BankrX or OpenSea
    /// @param sourceUrl Social post link or marketplace contract link
    /// @param complexity Difficulty rating for building companion animations
    /// @param durationInSeconds Ballot duration (e.g. 1 days, 3 days, 7 days)
    function createProposal(
        string calldata collectionName,
        CollectionSource source,
        string calldata sourceUrl,
        ComplexityTier complexity,
        uint256 durationInSeconds
    ) external returns (uint256 proposalId) {
        // Enforce owner or minimum holding threshold for creation
        if (msg.sender != owner()) {
            uint256 balance = frensToken.balanceOf(msg.sender);
            if (balance < minHoldingThreshold) {
                revert BelowThreshold(balance, minHoldingThreshold);
            }
        }

        // Permitted durations: 1 day, 3 days, 7 days, or owner custom test durations (> 1 minute)
        if (durationInSeconds < 60 || durationInSeconds > 30 days) {
            revert InvalidDuration(durationInSeconds);
        }

        unchecked {
            proposalId = ++proposalCount;
        }

        uint256 start = block.timestamp;
        uint256 end = start + durationInSeconds;

        proposals[proposalId] = Proposal({
            id: proposalId,
            collectionName: collectionName,
            source: source,
            sourceUrl: sourceUrl,
            complexity: complexity,
            startTime: start,
            endTime: end,
            holdVotes: 0,
            rawBurnedAmount: 0,
            totalWeight: 0,
            exists: true
        });

        emit ProposalCreated(proposalId, collectionName, source, complexity, start, end);
    }

    /// @notice Compute the permanent boost bonus weight for a given voter on a base weight.
    /// @dev Bonus = baseWeight * (userTotalBurned * permanentBoostBps) / (PERMANENT_BOOST_UNIT * PERMANENT_BOOST_DENOMINATOR)
    function getPermanentBoostBonus(address voter, uint256 baseWeight) public view returns (uint256 bonus) {
        uint256 totalBurned = userTotalBurned[voter];
        if (totalBurned == 0 || permanentBoostBps == 0 || baseWeight == 0) return 0;
        bonus = (baseWeight * totalBurned * permanentBoostBps) / (PERMANENT_BOOST_UNIT * PERMANENT_BOOST_DENOMINATOR);
    }

    /// @notice Cast a hold vote using current FRENS token balance without spending tokens.
    /// @dev Automatically includes the permanent boost earned from lifetime burned tokens!
    /// @param proposalId The ID of the proposal.
    function castHoldVote(uint256 proposalId) external nonReentrant {
        Proposal storage p = proposals[proposalId];
        if (!p.exists) revert ProposalNotFound(proposalId);
        if (block.timestamp < p.startTime || block.timestamp > p.endTime) {
            revert VotingNotActive(proposalId, block.timestamp, p.startTime, p.endTime);
        }
        if (hasHoldVoted[proposalId][msg.sender]) {
            revert AlreadyHoldVoted(proposalId, msg.sender);
        }

        uint256 balance = frensToken.balanceOf(msg.sender);
        if (balance < minHoldingThreshold) {
            revert BelowThreshold(balance, minHoldingThreshold);
        }

        uint256 permanentBonus = getPermanentBoostBonus(msg.sender, balance);
        uint256 totalCastWeight = balance + permanentBonus;

        hasHoldVoted[proposalId][msg.sender] = true;
        voterHoldVotes[proposalId][msg.sender] = totalCastWeight;

        p.holdVotes += totalCastWeight;
        p.totalWeight += totalCastWeight;

        emit HoldVoteCast(proposalId, msg.sender, balance, permanentBonus, totalCastWeight);
    }

    /// @notice Cast a heavily weighted burn vote by permanently sending FRENS to dead address.
    /// @dev Burned votes receive the Frenzy multiplier (e.g. 5x weight) on this ballot,
    ///      AND increase the voter's permanent boost across all future ballots!
    /// @param proposalId The ID of the proposal.
    /// @param burnAmount Amount of FRENS tokens (in wei) to burn.
    function castBurnVote(uint256 proposalId, uint256 burnAmount) external nonReentrant {
        if (burnAmount == 0) revert ZeroBurnAmount();
        Proposal storage p = proposals[proposalId];
        if (!p.exists) revert ProposalNotFound(proposalId);
        if (block.timestamp < p.startTime || block.timestamp > p.endTime) {
            revert VotingNotActive(proposalId, block.timestamp, p.startTime, p.endTime);
        }

        // Must hold at least threshold before burning
        uint256 balance = frensToken.balanceOf(msg.sender);
        if (balance < minHoldingThreshold) {
            revert BelowThreshold(balance, minHoldingThreshold);
        }

        // Permanently transfer to the dead address
        frensToken.safeTransferFrom(msg.sender, DEAD_ADDRESS, burnAmount);

        // Update lifetime burn total for permanent future boost
        userTotalBurned[msg.sender] += burnAmount;

        uint256 instantAddedWeight = burnAmount * burnMultiplier;

        voterBurnedAmount[proposalId][msg.sender] += burnAmount;
        p.rawBurnedAmount += burnAmount;
        p.totalWeight += instantAddedWeight;

        emit BurnVoteCast(proposalId, msg.sender, burnAmount, instantAddedWeight, userTotalBurned[msg.sender]);
    }

    /// @notice Admin function to adjust permanent boost basis points.
    function setPermanentBoostBps(uint256 newBps) external onlyOwner {
        uint256 old = permanentBoostBps;
        permanentBoostBps = newBps;
        emit PermanentBoostBpsUpdated(old, newBps);
    }

    /// @notice Get proposal details and current standings.
    function getProposal(uint256 proposalId) external view returns (
        Proposal memory proposal,
        bool isActive,
        uint256 timeRemaining
    ) {
        proposal = proposals[proposalId];
        if (!proposal.exists) revert ProposalNotFound(proposalId);

        isActive = (block.timestamp >= proposal.startTime && block.timestamp <= proposal.endTime);
        timeRemaining = block.timestamp < proposal.endTime ? proposal.endTime - block.timestamp : 0;
    }

    /// @notice Admin function to update the burn multiplier.
    function setBurnMultiplier(uint256 newMultiplier) external onlyOwner {
        if (newMultiplier == 0) revert InvalidMultiplier();
        uint256 old = burnMultiplier;
        burnMultiplier = newMultiplier;
        emit BurnMultiplierUpdated(old, newMultiplier);
    }

    /// @notice Admin function to update the minimum holding requirement.
    function setMinHoldingThreshold(uint256 newThreshold) external onlyOwner {
        uint256 old = minHoldingThreshold;
        minHoldingThreshold = newThreshold;
        emit MinHoldingThresholdUpdated(old, newThreshold);
    }
}
