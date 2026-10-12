// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TinyFrens Treasury (UUPS proxy)
/// @notice Holds ETH + FRENS on behalf of the game. Anyone can fund; only the
///         game controller can pay out. Upgradeable + pausable; owner is expected
///         to be a multisig/timelock on mainnet.
contract Treasury is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    /// @notice Address allowed to move funds out (game server / controller contract).
    address public gameController;

    event ControllerUpdated(address indexed controller);
    event Funded(address indexed from, address indexed token, uint256 amount);
    event Payout(address indexed to, address indexed token, uint256 amount);

    error NotController();
    error ZeroAddress();
    error InsufficientBalance();
    error TransferFailed();

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

    /// @notice Plain ETH transfers are treated as funding.
    receive() external payable {
        emit Funded(msg.sender, address(0), msg.value);
    }

    function fundETH() external payable {
        emit Funded(msg.sender, address(0), msg.value);
    }

    function fundERC20(address token, uint256 amount) external {
        if (token == address(0)) revert ZeroAddress();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, token, amount);
    }

    function payETH(address to, uint256 amount) external onlyController whenNotPaused nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (address(this).balance < amount) revert InsufficientBalance();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Payout(to, address(0), amount);
    }

    function payERC20(address token, address to, uint256 amount) external onlyController whenNotPaused nonReentrant {
        if (to == address(0) || token == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Payout(to, token, amount);
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
