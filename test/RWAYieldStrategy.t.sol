// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {RWAYieldStrategy} from "../src/RWAYieldStrategy.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract RWAYieldStrategyTest is Test {
    RWAYieldStrategy internal strategy;
    MockUSDC internal usdc;
    address internal admin = address(0xA11CE);
    address internal user = address(0xB0B);
    address internal recipient = address(0xCAFE);

    function setUp() public {
        usdc = new MockUSDC();
        usdc.mint(user, 2_000e6);

        vm.prank(admin);
        strategy = new RWAYieldStrategy(admin, address(0x1001), 1, address(usdc));
    }

    function testStrategyExecute() public {
        vm.prank(user);
        usdc.approve(address(strategy), type(uint256).max);

        vm.prank(user);
        strategy.deposit(1_000e6);

        vm.prank(admin);
        strategy.reportYield(50e6);

        vm.prank(admin);
        (bool ok, uint256 compounded) = strategy.execute();

        assertTrue(ok);
        assertEq(compounded, 50e6);
        assertEq(strategy.pendingYield(), 0);
        assertEq(strategy.totalManagedAssets(), 1_050e6);
        assertEq(strategy.getHealthFactor(), 1_050_000_000_000_000_000);
        assertEq(usdc.balanceOf(address(strategy)), 1_050e6);
    }

    function testDepositWithdraw() public {
        vm.prank(user);
        usdc.approve(address(strategy), type(uint256).max);

        vm.startPrank(user);
        strategy.deposit(500e6);
        strategy.withdraw(200e6, recipient);
        vm.stopPrank();

        assertEq(strategy.principalOf(user), 300e6);
        assertEq(strategy.totalPrincipal(), 300e6);
        assertEq(strategy.totalManagedAssets(), 300e6);
        assertEq(usdc.balanceOf(recipient), 200e6);
    }

    function testAutomationHooks() public {
        vm.prank(user);
        usdc.approve(address(strategy), type(uint256).max);

        vm.prank(user);
        strategy.deposit(500e6);

        vm.prank(admin);
        strategy.reportYield(10e6);

        (bool upkeepNeeded,) = strategy.checkUpkeep("");
        assertTrue(upkeepNeeded);

        strategy.performUpkeep("");
        assertEq(strategy.pendingYield(), 0);
    }
}
