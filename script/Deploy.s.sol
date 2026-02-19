// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";
import {RWAYieldStrategy} from "../src/RWAYieldStrategy.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// @title DeployScript
/// @notice Deploys AgentRegistry and RWAYieldStrategy for Base Sepolia.
contract DeployScript is Script {
    /// @notice Canonical Base Sepolia USDC.
    address public constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external {
        bool useMockAsset = vm.envOr("USE_MOCK_ASSET", false);
        uint256 configuredAgentId = vm.envOr("AGENT_ID", uint256(1));
        address configuredAsset = vm.envOr("ASSET_ADDRESS", BASE_SEPOLIA_USDC);

        vm.startBroadcast();

        address deployer = tx.origin;
        AgentRegistry registry = new AgentRegistry(deployer);

        address assetAddress = configuredAsset;
        if (useMockAsset) {
            MockUSDC mock = new MockUSDC();
            assetAddress = address(mock);
        }

        RWAYieldStrategy strategy = new RWAYieldStrategy(deployer, address(registry), configuredAgentId, assetAddress);

        vm.stopBroadcast();

        console2.log("Deployer:", deployer);
        console2.log("AgentRegistry:", address(registry));
        console2.log("RWAYieldStrategy:", address(strategy));
        console2.log("Asset:", assetAddress);
    }
}
