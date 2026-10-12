// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {DepositSession} from "./DepositSession.sol";

/// @title TinyFrens DepositRouter (UUPS proxy)
/// @notice Mints a unique minimal-proxy deposit address per session. Only the game
///         controller may open/close sessions; the server holds that key. Funds
///         land in the Treasury and `DepositSession.Deposit` events let the indexer
///         attribute each transfer to a player with no user-supplied tx hash.
contract DepositRouter is Initializable, Ownable2StepUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    address public treasury;
    address public sessionImplementation;
    address public gameController;

    mapping(bytes32 => address) public sessionAddress;
    mapping(address => bytes32) public sessionIdOf;

    event ControllerUpdated(address indexed controller);
    event TreasuryUpdated(address indexed treasury);
    event SessionImplementationUpdated(address indexed implementation);
    event SessionCreated(bytes32 indexed sessionId, address indexed session, address indexed token);
    event SessionClosed(bytes32 indexed sessionId, address indexed session);

    error NotController();
    error ZeroAddress();
    error SessionExists();
    error UnknownSession();

    modifier onlyController() {
        if (msg.sender != gameController) revert NotController();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address controller_,
        address treasury_,
        address sessionImplementation_
    ) external initializer {
        if (owner_ == address(0) || controller_ == address(0) || treasury_ == address(0) || sessionImplementation_ == address(0)) {
            revert ZeroAddress();
        }
        __Ownable_init(owner_);
        __Pausable_init();
        gameController = controller_;
        treasury = treasury_;
        sessionImplementation = sessionImplementation_;
        emit ControllerUpdated(controller_);
        emit TreasuryUpdated(treasury_);
        emit SessionImplementationUpdated(sessionImplementation_);
    }

    /// @notice Open a deposit address for `sessionId`. `token == address(0)` means ETH.
    function createSession(bytes32 sessionId, address token) external onlyController whenNotPaused returns (address session) {
        if (sessionId == bytes32(0)) revert ZeroAddress();
        if (sessionAddress[sessionId] != address(0)) revert SessionExists();
        session = Clones.clone(sessionImplementation);
        DepositSession(payable(session)).initialize(treasury, token, sessionId);
        sessionAddress[sessionId] = session;
        sessionIdOf[session] = sessionId;
        emit SessionCreated(sessionId, session, token);
    }

    /// @notice Stop attributing deposits for `sessionId`. Does not move funds.
    function closeSession(bytes32 sessionId) external onlyController {
        address session = sessionAddress[sessionId];
        if (session == address(0)) revert UnknownSession();
        delete sessionAddress[sessionId];
        delete sessionIdOf[session];
        emit SessionClosed(sessionId, session);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setSessionImplementation(address implementation_) external onlyOwner {
        if (implementation_ == address(0)) revert ZeroAddress();
        sessionImplementation = implementation_;
        emit SessionImplementationUpdated(implementation_);
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
