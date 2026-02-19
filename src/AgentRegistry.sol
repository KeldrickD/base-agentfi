// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AgentRegistry
/// @notice ERC721 registry for autonomous DeFi agent identities on Base.
/// @dev Each token represents one agent instance with metadata and a linked wallet placeholder.
contract AgentRegistry is ERC721, Ownable {
    /// @notice Tracks key metadata for an agent instance.
    struct AgentInfo {
        address agentOwner;
        string metadataURI;
        address linkedAgentWallet;
        uint64 createdAt;
    }

    /// @notice Next token id to mint.
    uint256 public nextAgentId = 1;

    /// @notice Token id => agent record.
    mapping(uint256 agentId => AgentInfo info) private _agentInfo;

    event AgentMinted(
        uint256 indexed agentId,
        address indexed agentOwner,
        address indexed linkedAgentWallet,
        string metadataURI
    );
    event AgentMetadataUpdated(uint256 indexed agentId, string metadataURI);
    event AgentWalletLinked(uint256 indexed agentId, address indexed linkedAgentWallet);

    error InvalidOwner();
    error Unauthorized();
    error AgentDoesNotExist(uint256 agentId);

    /// @param initialOwner Owner/admin for registry controls.
    constructor(address initialOwner) ERC721("Base Agent Registry", "BAGENT") Ownable(initialOwner) {}

    /// @notice Mint a new agent instance NFT.
    /// @param agentOwner EOA or smart account that owns this agent token.
    /// @param metadataURI Off-chain metadata URI describing strategy config/identity.
    /// @param linkedAgentWallet Placeholder agent wallet address.
    /// @return agentId Newly created agent id.
    function mintAgent(
        address agentOwner,
        string calldata metadataURI,
        address linkedAgentWallet
    ) external returns (uint256 agentId) {
        if (agentOwner == address(0)) revert InvalidOwner();
        if (msg.sender != owner() && msg.sender != agentOwner) revert Unauthorized();

        agentId = nextAgentId++;
        _safeMint(agentOwner, agentId);

        _agentInfo[agentId] = AgentInfo({
            agentOwner: agentOwner,
            metadataURI: metadataURI,
            linkedAgentWallet: linkedAgentWallet,
            createdAt: uint64(block.timestamp)
        });

        // TODO: integrate awal CLI or CDP SDK for agent wallet actions.
        emit AgentMinted(agentId, agentOwner, linkedAgentWallet, metadataURI);
    }

    /// @notice Returns agent record for a token id.
    function getAgentInfo(uint256 agentId) external view returns (AgentInfo memory) {
        if (_ownerOf(agentId) == address(0)) revert AgentDoesNotExist(agentId);
        return _agentInfo[agentId];
    }

    /// @notice Update metadata URI for an agent.
    function setAgentMetadataURI(uint256 agentId, string calldata metadataURI) external {
        _requireTokenOwnerOrAdmin(agentId);
        _agentInfo[agentId].metadataURI = metadataURI;
        emit AgentMetadataUpdated(agentId, metadataURI);
    }

    /// @notice Update linked wallet placeholder for an agent.
    function setLinkedAgentWallet(uint256 agentId, address linkedAgentWallet) external {
        _requireTokenOwnerOrAdmin(agentId);
        _agentInfo[agentId].linkedAgentWallet = linkedAgentWallet;

        // TODO: integrate awal CLI or CDP SDK for agent wallet actions.
        emit AgentWalletLinked(agentId, linkedAgentWallet);
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 agentId) public view override returns (string memory) {
        if (_ownerOf(agentId) == address(0)) revert AgentDoesNotExist(agentId);
        return _agentInfo[agentId].metadataURI;
    }

    function _requireTokenOwnerOrAdmin(uint256 agentId) internal view {
        if (_ownerOf(agentId) == address(0)) revert AgentDoesNotExist(agentId);
        if (msg.sender != ownerOf(agentId) && msg.sender != owner()) revert Unauthorized();
    }
}
