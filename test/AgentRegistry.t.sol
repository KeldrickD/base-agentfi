// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentRegistry} from "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry internal registry;
    address internal admin = address(0xA11CE);
    address internal agentOwner = address(0xB0B);
    address internal wallet = address(0xCAFE);

    function setUp() public {
        vm.prank(admin);
        registry = new AgentRegistry(admin);
    }

    function testAgentMint() public {
        vm.prank(agentOwner);
        uint256 id = registry.mintAgent(agentOwner, "ipfs://agent-metadata", wallet);

        assertEq(id, 1);
        assertEq(registry.ownerOf(id), agentOwner);
        assertEq(registry.tokenURI(id), "ipfs://agent-metadata");

        AgentRegistry.AgentInfo memory info = registry.getAgentInfo(id);
        assertEq(info.agentOwner, agentOwner);
        assertEq(info.metadataURI, "ipfs://agent-metadata");
        assertEq(info.linkedAgentWallet, wallet);
        assertGt(info.createdAt, 0);
    }
}
