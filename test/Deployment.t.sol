// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {RWAYieldStrategy} from "../src/RWAYieldStrategy.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract DeploymentTest is Test {
    AgentRegistry internal registry;
    RWAYieldStrategy internal strategy;
    MockUSDC internal usdc;

    address internal deployer = address(0xA11CE);
    address internal agentOwner = address(0xB0B);
    address internal recipient = address(0xCAFE);

    function testDeploymentAndInteraction() public {
        vm.startPrank(deployer);
        registry = new AgentRegistry(deployer);
        usdc = new MockUSDC();
        strategy = new RWAYieldStrategy(deployer, address(registry), 1, address(usdc));
        vm.stopPrank();

        vm.prank(agentOwner);
        uint256 agentId = registry.mintAgent(agentOwner, "ipfs://agent/1", address(0));
        assertEq(agentId, 1);

        usdc.mint(agentOwner, 2_000e6);

        vm.startPrank(agentOwner);
        usdc.approve(address(strategy), type(uint256).max);
        strategy.deposit(1_000e6);
        strategy.withdraw(200e6, recipient);
        vm.stopPrank();

        vm.prank(deployer);
        strategy.reportYield(50e6);

        vm.prank(deployer);
        (bool ok, uint256 compounded) = strategy.execute();

        assertTrue(ok);
        assertEq(compounded, 50e6);
        assertEq(usdc.balanceOf(address(strategy)), 850e6);
        assertEq(strategy.totalPrincipal(), 800e6);
        assertEq(strategy.totalManagedAssets(), 850e6);
        assertEq(usdc.balanceOf(recipient), 200e6);
    }
}
