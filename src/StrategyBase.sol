// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title StrategyBase
/// @notice Abstract base for autonomous agent strategy modules.
/// @dev Child strategies should implement execution and health checks.
abstract contract StrategyBase is Ownable {
    /// @notice Registry that tracks agent identities.
    address public immutable agentRegistry;

    /// @notice Agent id associated with this strategy.
    uint256 public immutable agentId;

    /// @notice Underlying strategy asset (e.g., USDC).
    address public immutable asset;

    event StrategyExecuted(
        uint256 indexed agentId,
        address indexed caller,
        string action,
        uint256 amountIn,
        uint256 amountOut
    );
    event Deposit(address indexed caller, uint256 amount);
    event Withdraw(address indexed caller, address indexed recipient, uint256 amount);
    event HealthFactorUpdated(uint256 indexed agentId, uint256 healthFactor);

    /// @param initialOwner Owner/controller for strategy operations.
    /// @param registry Agent registry contract address.
    /// @param linkedAgentId Agent id from registry.
    /// @param strategyAsset Underlying token this strategy manages.
    constructor(address initialOwner, address registry, uint256 linkedAgentId, address strategyAsset) Ownable(initialOwner) {
        agentRegistry = registry;
        agentId = linkedAgentId;
        asset = strategyAsset;
    }

    /// @notice Execute strategy action (rebalance, compound, etc.).
    /// @return success Whether execution completed.
    /// @return actionResult Amount/result produced by execution.
    function execute() external virtual returns (bool success, uint256 actionResult);

    /// @notice Check whether execution conditions are currently satisfied.
    function checkCondition() public view virtual returns (bool);

    /// @notice Return strategy health factor using 1e18 precision.
    function getHealthFactor() public view virtual returns (uint256);
}
