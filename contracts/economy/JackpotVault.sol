// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TinyFrens JackpotVault (UUPS proxy)
/// @notice Holds one or more named pools (ETH or a single ERC-20 each). Anyone can
///         fund a pool; only the game controller can draw a winner and pay out of a
///         pool. Win probability / caps are decided off-chain by the game server and
///         enforced here by pool balance + pause only.
contract JackpotVault is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    struct Pool {
        address token; // address(0) == ETH
        uint256 balance;
        bool active;
        bool exists;
    }

    address public gameController;
    mapping(bytes32 => Pool) internal _pools;

    event ControllerUpdated(address indexed controller);
    event PoolCreated(bytes32 indexed poolId, address indexed token);
    event PoolActiveUpdated(bytes32 indexed poolId, bool active);
    event PoolFunded(bytes32 indexed poolId, address indexed from, uint256 amount);
    event JackpotWon(bytes32 indexed poolId, address indexed winner, address indexed token, uint256 amount);

    error NotController();
    error ZeroAddress();
    error PoolExists();
    error UnknownPool();
    error InactivePool();
    error InsufficientPool();
    error TransferFailed();
    error TokenMismatch();

    modifier onlyController() {
        if (msg.sender != gameController) revert NotController();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address controller_) external initializer {
        if (owner_ == address(0) || controller_ == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
        __Pausable_init();
        gameController = controller_;
        emit ControllerUpdated(controller_);
    }

    function createPool(bytes32 poolId, address token) external onlyOwner {
        if (_pools[poolId].exists) revert PoolExists();
        _pools[poolId] = Pool({token: token, balance: 0, active: true, exists: true});
        emit PoolCreated(poolId, token);
        emit PoolActiveUpdated(poolId, true);
    }

    function setPoolActive(bytes32 poolId, bool active) external onlyOwner {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert UnknownPool();
        pool.active = active;
        emit PoolActiveUpdated(poolId, active);
    }

    /// @notice Fund an ETH pool. `msg.value` becomes part of the pool.
    function fundETH(bytes32 poolId) external payable {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert UnknownPool();
        if (pool.token != address(0)) revert TokenMismatch();
        pool.balance += msg.value;
        emit PoolFunded(poolId, msg.sender, msg.value);
    }

    /// @notice Fund an ERC-20 pool.
    function fundERC20(bytes32 poolId, uint256 amount) external {
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert UnknownPool();
        if (pool.token == address(0)) revert TokenMismatch();
        IERC20(pool.token).safeTransferFrom(msg.sender, address(this), amount);
        pool.balance += amount;
        emit PoolFunded(poolId, msg.sender, amount);
    }

    /// @notice Controller-only payout: pays `winner` `amount` out of `poolId`.
    function drawWinner(bytes32 poolId, address winner, uint256 amount)
        external
        onlyController
        whenNotPaused
        nonReentrant
    {
        if (winner == address(0)) revert ZeroAddress();
        Pool storage pool = _pools[poolId];
        if (!pool.exists) revert UnknownPool();
        if (!pool.active) revert InactivePool();
        if (pool.balance < amount) revert InsufficientPool();

        pool.balance -= amount;

        if (pool.token == address(0)) {
            (bool ok,) = winner.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(pool.token).safeTransfer(winner, amount);
        }

        emit JackpotWon(poolId, winner, pool.token, amount);
    }

    function poolInfo(bytes32 poolId) external view returns (address token, uint256 balance, bool active) {
        Pool storage pool = _pools[poolId];
        return (pool.token, pool.balance, pool.active);
    }

    function setGameController(address controller) external onlyOwner {
        if (controller == address(0)) revert ZeroAddress();
        gameController = controller;
        emit ControllerUpdated(controller);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
