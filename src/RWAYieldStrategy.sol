// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {StrategyBase} from "./StrategyBase.sol";

/// @notice Minimal Chainlink Automation compatibility interface.
interface AutomationCompatibleInterface {
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData);
    function performUpkeep(bytes calldata performData) external;
}

/// @notice Optional mint hook for mock assets used in local/testing environments.
interface IERC20Mintable {
    function mint(address to, uint256 amount) external;
}

/// @title RWAYieldStrategy
/// @notice Mock strategy for auto-compounding USDC/RWA-style yield flows.
/// @dev Uses ERC20 transfers and optional mint-simulated yield for prototyping.
contract RWAYieldStrategy is StrategyBase, AutomationCompatibleInterface {
    using SafeERC20 for IERC20;

    /// @notice ERC20 token managed by this strategy (e.g., Base Sepolia USDC).
    IERC20 public immutable assetToken;

    /// @notice Total principal currently deposited.
    uint256 public totalPrincipal;

    /// @notice Total managed assets including compounded yield.
    uint256 public totalManagedAssets;

    /// @notice Yield pending compounding.
    uint256 public pendingYield;

    /// @notice User accounting for this mock strategy.
    mapping(address account => uint256 principalBalance) public principalOf;

    /// @notice Emitted when strategy health falls below safe threshold.
    event LiquidationRisk(uint256 indexed agentId, uint256 healthFactor);
    event UpkeepPerformed(address indexed caller, bytes performData);

    error AmountZero();
    error InvalidRecipient();
    error InsufficientPrincipal();

    /// @param initialOwner Owner/controller for strategy actions.
    /// @param registry Agent registry address.
    /// @param linkedAgentId Agent id in registry.
    /// @param strategyAsset Underlying asset (e.g., Base Sepolia USDC).
    constructor(
        address initialOwner,
        address registry,
        uint256 linkedAgentId,
        address strategyAsset
    ) StrategyBase(initialOwner, registry, linkedAgentId, strategyAsset) {
        assetToken = IERC20(strategyAsset);
    }

    /// @notice Deposit principal into strategy by transferring USDC to this contract.
    /// @param amount Deposit amount.
    function deposit(uint256 amount) external {
        if (amount == 0) revert AmountZero();

        // TODO: integrate awal CLI or CDP SDK for agent wallet actions.
        assetToken.safeTransferFrom(msg.sender, address(this), amount);
        principalOf[msg.sender] += amount;
        totalPrincipal += amount;
        totalManagedAssets += amount;

        emit Deposit(msg.sender, amount);
    }

    /// @notice Withdraw principal from strategy and transfer USDC to recipient.
    /// @param amount Withdraw amount.
    /// @param recipient Receiver of withdrawn funds.
    function withdraw(uint256 amount, address recipient) external {
        if (amount == 0) revert AmountZero();
        if (recipient == address(0)) revert InvalidRecipient();
        if (principalOf[msg.sender] < amount) revert InsufficientPrincipal();

        principalOf[msg.sender] -= amount;
        totalPrincipal -= amount;
        totalManagedAssets -= amount;

        // TODO: integrate awal CLI or CDP SDK for agent wallet actions.
        assetToken.safeTransfer(recipient, amount);
        emit Withdraw(msg.sender, recipient, amount);
    }

    /// @notice Mock hook to simulate yield accrual from lending/RWA sources.
    /// @dev Owner-only to imitate trusted keeper/oracle updates in this scaffold.
    function reportYield(uint256 amount) external onlyOwner {
        if (amount == 0) revert AmountZero();
        pendingYield += amount;
    }

    /// @inheritdoc StrategyBase
    function execute() external override onlyOwner returns (bool success, uint256 actionResult) {
        return _executeInternal(msg.sender, "");
    }

    /// @inheritdoc AutomationCompatibleInterface
    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory performData) {
        upkeepNeeded = checkCondition() && getHealthFactor() >= 1e18;
        performData = abi.encode(agentId, pendingYield);
    }

    /// @inheritdoc AutomationCompatibleInterface
    function performUpkeep(bytes calldata performData) external override {
        (bool success,) = _executeInternal(msg.sender, performData);
        require(success, "upkeep-not-needed");
        emit UpkeepPerformed(msg.sender, performData);
    }

    function _executeInternal(address caller, bytes memory) internal returns (bool success, uint256 actionResult) {
        if (!checkCondition()) {
            return (false, 0);
        }

        uint256 healthFactor = getHealthFactor();
        if (healthFactor < 1e18) {
            emit LiquidationRisk(agentId, healthFactor);
            return (false, 0);
        }

        uint256 compounded = pendingYield;
        pendingYield = 0;

        // For mock environments, attempt to mint yield into this contract.
        // On real Base Sepolia USDC this will likely fail and safely fall back to accounting-only yield.
        try IERC20Mintable(address(assetToken)).mint(address(this), compounded) {} catch {}

        totalManagedAssets += compounded;

        emit StrategyExecuted(agentId, caller, "AUTO_COMPOUND", compounded, totalManagedAssets);
        emit HealthFactorUpdated(agentId, getHealthFactor());
        return (true, compounded);
    }

    /// @inheritdoc StrategyBase
    function checkCondition() public view override returns (bool) {
        return pendingYield > 0 && totalManagedAssets > 0;
    }

    /// @inheritdoc StrategyBase
    function getHealthFactor() public view override returns (uint256) {
        if (totalPrincipal == 0) {
            return 1e18;
        }

        // Basic proxy metric: managed assets / principal in 1e18 precision.
        return (totalManagedAssets * 1e18) / totalPrincipal;
    }
}
