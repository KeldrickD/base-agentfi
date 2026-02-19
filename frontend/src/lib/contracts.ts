export const deployedAddresses = {
  registry: (process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ||
    "0xaB2c67381CD98F134F79C9E725dd13b97dd9C8Da") as `0x${string}`,
  strategy: (process.env.NEXT_PUBLIC_STRATEGY_ADDRESS ||
    "0x1c8f5f6c3897C8b0Bc29F978cdd14cC689563247") as `0x${string}`,
  asset: (process.env.NEXT_PUBLIC_USDC_ADDRESS ||
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`,
};

export const registryAbi = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "mintAgent",
    inputs: [
      { name: "agentOwner", type: "address" },
      { name: "metadataURI", type: "string" },
      { name: "linkedAgentWallet", type: "address" },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "nextAgentId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getAgentInfo",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        name: "info",
        type: "tuple",
        components: [
          { name: "agentOwner", type: "address" },
          { name: "metadataURI", type: "string" },
          { name: "linkedAgentWallet", type: "address" },
          { name: "createdAt", type: "uint64" },
        ],
      },
    ],
  },
] as const;

export const strategyAbi = [
  {
    type: "function",
    stateMutability: "view",
    name: "getHealthFactor",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "totalManagedAssets",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "pendingYield",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "checkUpkeep",
    inputs: [{ name: "checkData", type: "bytes" }],
    outputs: [
      { name: "upkeepNeeded", type: "bool" },
      { name: "performData", type: "bytes" },
    ],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "performUpkeep",
    inputs: [{ name: "performData", type: "bytes" }],
    outputs: [],
  },
] as const;
