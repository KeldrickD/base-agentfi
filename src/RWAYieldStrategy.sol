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
/// @notice Public AgentFi Yield Vault with autonomous compounding and performance fees.
/// @dev ERC4626-lite share accounting for USDC vault deposits from users/agents.
contract RWAYieldStrategy is StrategyBase, AutomationCompatibleInterface {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant performanceFee = 1_500; // 15% of realized yield

    /// @notice ERC20 token managed by this strategy (e.g., Base Sepolia USDC).
    IERC20 public immutable assetToken;

    /// @notice Recipient of performance fees (agent owner).
    address public immutable feeRecipient;

    /// @notice Total vault share supply.
    uint256 public totalSupply;

    /// @notice Account share balances.
    mapping(address account => uint256 shares) public balanceOf;

    /// @notice Total managed assets backing all shares.
    uint256 public totalManagedAssets;

    /// @notice Yield pending compounding.
    uint256 public pendingYield;

    /// @notice Total fees successfully transferred to feeRecipient.
    uint256 public earnedFees;

    /// @notice Emitted when strategy health falls below safe threshold.
    event LiquidationRisk(uint256 indexed agentId, uint256 healthFactor);
    event UpkeepPerformed(address indexed caller, bytes performData);
    event FeeCollected(address indexed recipient, uint256 amount);
    event VaultDeposit(address indexed caller, uint256 assets, uint256 shares);
    event VaultWithdraw(address indexed caller, uint256 shares, uint256 assets);

    error AmountZero();
    error InsufficientShares();
    error ZeroSharesMinted();
    error ZeroAssetsOut();

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
        feeRecipient = initialOwner;
    }

    /// @notice Deposit USDC into the public vault and receive shares.
    /// @param assets Amount of USDC assets to deposit (6 decimals for USDC).
    /// @return shares Minted vault shares.
    function deposit(uint256 assets) external returns (uint256 shares) {
        if (assets == 0) revert AmountZero();

        // TODO: integrate awal CLI or CDP SDK for agent wallet actions.
        if (totalSupply == 0 || totalManagedAssets == 0) {
            shares = assets;
        } else {
            shares = (assets * totalSupply) / totalManagedAssets;
        }
        if (shares == 0) revert ZeroSharesMinted();

        assetToken.safeTransferFrom(msg.sender, address(this), assets);
        totalSupply += shares;
        balanceOf[msg.sender] += shares;
        totalManagedAssets += assets;

        emit Deposit(msg.sender, assets);
        emit VaultDeposit(msg.sender, assets, shares);
    }

    /// @notice Withdraw vault shares back into USDC.
    /// @param shares Amount of shares to burn.
    /// @return assets USDC returned to sender.
    function withdraw(uint256 shares) external returns (uint256 assets) {
        if (shares == 0) revert AmountZero();
        if (balanceOf[msg.sender] < shares) revert InsufficientShares();

        assets = (shares * totalManagedAssets) / totalSupply;
        if (assets == 0) revert ZeroAssetsOut();

        balanceOf[msg.sender] -= shares;
        totalSupply -= shares;
        totalManagedAssets -= assets;

        // TODO: integrate awal CLI or CDP SDK for agent wallet actions.
        assetToken.safeTransfer(msg.sender, assets);
        emit Withdraw(msg.sender, msg.sender, assets);
        emit VaultWithdraw(msg.sender, shares, assets);
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

        uint256 requestedYield = pendingYield;

        // For mock environments, attempt to mint yield into this contract.
        // On non-mintable assets, a separate yield source can pre-fund the vault.
        try IERC20Mintable(address(assetToken)).mint(address(this), requestedYield) {} catch {}

        // Realized yield is any asset surplus sitting above accounted TVL.
        // This works for real USDC flows where yield is transferred in externally.
        uint256 balanceAfter = assetToken.balanceOf(address(this));
        uint256 availableYield = balanceAfter > totalManagedAssets ? balanceAfter - totalManagedAssets : 0;
        uint256 realizedYield = availableYield > requestedYield ? requestedYield : availableYield;
        if (realizedYield == 0) {
            return (false, 0);
        }
        pendingYield = requestedYield - realizedYield;

        uint256 fee = (realizedYield * performanceFee) / BPS_DENOMINATOR;
        uint256 netYield = realizedYield - fee;
        totalManagedAssets += netYield;

        if (fee > 0) {
            assetToken.safeTransfer(feeRecipient, fee);
            earnedFees += fee;
            emit FeeCollected(feeRecipient, fee);
        }

        emit StrategyExecuted(agentId, caller, "AUTO_COMPOUND", realizedYield, totalManagedAssets);
        emit HealthFactorUpdated(agentId, getHealthFactor());
        return (true, netYield);
    }

    /// @inheritdoc StrategyBase
    function checkCondition() public view override returns (bool) {
        return pendingYield > 0 && totalSupply > 0 && totalManagedAssets > 0;
    }

    /// @inheritdoc StrategyBase
    function getHealthFactor() public view override returns (uint256) {
        if (totalSupply == 0) {
            return 1e18;
        }

        // Proxy metric: vault assets per share in 1e18 precision.
        return (totalManagedAssets * 1e18) / totalSupply;
    }
}
