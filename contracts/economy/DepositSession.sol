// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title TinyFrens DepositSession
/// @notice Minimal-proxy (EIP-1167 clone) target. One clone per deposit session,
///         assigned exclusively to a single fren/player. Incoming funds are
///         forwarded to the Treasury and a `Deposit` event — carrying the session
///         id — is emitted so the indexer can attribute the transfer to a player
///         without the user pasting a tx hash.
///
///         ETH sessions auto-forward on receive. ERC-20 sessions must be swept
///         (transfer tokens to the clone, then call `sweep()`) because ERC-20
///         transfers cannot trigger contract code.
///
///         Clones are one-shot: `initialize` may only be called once, and the
///         implementation disables its own initializer in the constructor.
contract DepositSession {
    using SafeERC20 for IERC20;

    bool private _initialized;
    address public treasury;
    address public token;
    bytes32 public sessionId;

    event Deposit(bytes32 indexed sessionId, address indexed sender, address indexed token, uint256 amount);

    error AlreadyInitialized();
    error NotInitialized();
    error ZeroAddress();
    error EthNotAccepted();
    error SweepNotForEth();
    error ForwardFailed();
    error NothingToSweep();

    constructor() {
        // Prevent the implementation itself from being initialized.
        _initialized = true;
    }

    function initialize(address treasury_, address token_, bytes32 sessionId_) external {
        if (_initialized) revert AlreadyInitialized();
        if (treasury_ == address(0)) revert ZeroAddress();
        _initialized = true;
        treasury = treasury_;
        token = token_;
        sessionId = sessionId_;
    }

    /// @notice ETH sessions only: forward the deposit to the Treasury immediately.
    receive() external payable {
        if (!_initialized) revert NotInitialized();
        if (token != address(0)) revert EthNotAccepted();
        emit Deposit(sessionId, msg.sender, address(0), msg.value);
        (bool ok,) = treasury.call{value: msg.value}("");
        if (!ok) revert ForwardFailed();
    }

    /// @notice ERC-20 sessions only: forward the full token balance to the Treasury.
    function sweep() external {
        if (!_initialized) revert NotInitialized();
        if (token == address(0)) revert SweepNotForEth();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance == 0) revert NothingToSweep();
        emit Deposit(sessionId, msg.sender, token, balance);
        IERC20(token).safeTransfer(treasury, balance);
    }
}
