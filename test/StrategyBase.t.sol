// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StrategyBase} from "../src/StrategyBase.sol";

contract MockStrategy is StrategyBase {
    bool internal shouldExecute;
    uint256 internal health = 1e18;

    constructor(address initialOwner, address registry, uint256 linkedAgentId, address strategyAsset)
        StrategyBase(initialOwner, registry, linkedAgentId, strategyAsset)
    {}

    function setExecutionCondition(bool status) external {
        shouldExecute = status;
    }

    function setHealthFactor(uint256 value) external {
        health = value;
    }

    function execute() external override returns (bool success, uint256 actionResult) {
        if (!shouldExecute) return (false, 0);

        emit StrategyExecuted(agentId, msg.sender, "MOCK_EXECUTE", 0, 1);
        emit HealthFactorUpdated(agentId, health);
        return (true, 1);
    }

    function checkCondition() public view override returns (bool) {
        return shouldExecute;
    }

    function getHealthFactor() public view override returns (uint256) {
        return health;
    }
}

contract StrategyBaseTest is Test {
    MockStrategy internal strategy;
    address internal admin = address(0xA11CE);

    function setUp() public {
        vm.prank(admin);
        strategy = new MockStrategy(admin, address(0x1001), 1, address(0x1002));
    }

    function testStrategyExecute() public {
        strategy.setExecutionCondition(true);
        (bool ok, uint256 result) = strategy.execute();

        assertTrue(ok);
        assertEq(result, 1);
        assertEq(strategy.getHealthFactor(), 1e18);
    }
}
