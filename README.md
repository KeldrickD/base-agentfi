# Base AgentFi

Framework for building **autonomous AI DeFi agents** on **Base** using Coinbase's **Agentic Wallets** (launched Feb 11, 2026).

Agents can:
- Hold & manage tokenized RWAs (inspired by my previous RWA Lending Vault)
- Auto-lend/borrow/compound yield
- Monitor & prevent liquidations
- Execute gasless trades/payments via x402 + ERC-4337
- All with programmable guardrails

**Why?** Base is pushing AI agents hard - Agentic Wallets give agents standalone wallets for spending, earning, trading with security controls. This project explores that + RWA/DeFi use cases.

**Tech stack (planned)**
- Solidity 0.8.24 + Foundry
- Base Sepolia / Mainnet
- Coinbase Agentic Wallets (via awal CLI / skills integration)
- Chainlink Automation / Functions (for triggers)
- ERC-4337 account abstraction

**Status:** Early scaffold with:
- `AgentRegistry` (ERC721 agent identity registry)
- `StrategyBase` (abstract strategy interface)
- `RWAYieldStrategy` (USDC-based mock auto-compound + automation hooks)
- Foundry tests and deployment script for Base Sepolia
- Offchain `agent-scripts/` runner for Agentic Wallet-style automation

Built by @xkldrckx | Open to feedback / collabs.

## Deploy (Base Sepolia)

Set environment variables:

```bash
export BASE_SEPOLIA_RPC_URL="https://..."
export BASESCAN_API_KEY="..."
```

Run all tests:

```bash
forge test -vv
```

Deploy with canonical Base Sepolia USDC:

```bash
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  -vvvv
```

Deploy using a freshly deployed mock asset instead:

```bash
USE_MOCK_ASSET=true forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  -vvvv
```

Optional runtime overrides:
- `AGENT_ID` (default: `1`)
- `ASSET_ADDRESS` (default: Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`)

After deployment, copy addresses from the script output logs:
- `AgentRegistry`
- `RWAYieldStrategy`

Latest live Base Sepolia deployment:
- `AgentRegistry`: `0xaB2c67381CD98F134F79C9E725dd13b97dd9C8Da`
- `RWAYieldStrategy`: `0x1c8f5f6c3897C8b0Bc29F978cdd14cC689563247`
- `Asset (USDC)`: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## Agentic Wallet Integration (Coinbase)

Agentic Wallets are used as the offchain autonomy layer:
- Authenticate/fund/manage the agent wallet via `awal` CLI skills
- Trigger onchain strategy actions (`checkUpkeep` + `performUpkeep`) on Base Sepolia
- Keep strategy rules enforced onchain while autonomy runs offchain

This repo includes `agent-scripts/index.js` to demonstrate the flow.

### Try It

```bash
cd agent-scripts
cp .env.example .env
npm install
npx skills add coinbase/agentic-wallet-skills
```

Edit `.env` with deployed addresses from `Deploy.s.sol` output:

```bash
STRATEGY_ADDRESS=0xYourRWAYieldStrategyAddress
REGISTRY_ADDRESS=0xYourAgentRegistryAddress
```

Run in dry mode first:

```bash
DRY_RUN=true node index.js
```

Run live:

```bash
node index.js
```

## Basescan Verification

If you already passed `--verify` during deployment, contracts should be auto-verified.

Manual verification examples:

```bash
forge verify-contract \
  --chain-id 84532 \
  --etherscan-api-key $BASESCAN_API_KEY \
  <AGENT_REGISTRY_ADDRESS> \
  src/AgentRegistry.sol:AgentRegistry \
  --constructor-args $(cast abi-encode "constructor(address)" <DEPLOYER_ADDRESS>)
```

```bash
forge verify-contract \
  --chain-id 84532 \
  --etherscan-api-key $BASESCAN_API_KEY \
  <RWA_YIELD_STRATEGY_ADDRESS> \
  src/RWAYieldStrategy.sol:RWAYieldStrategy \
  --constructor-args $(cast abi-encode "constructor(address,address,uint256,address)" <DEPLOYER_ADDRESS> <AGENT_REGISTRY_ADDRESS> 1 <ASSET_ADDRESS>)
```

## Frontend Demo

A Next.js 15 + Tailwind + Wagmi dashboard is included under `frontend/`.

Features:
- Connect wallet on Base Sepolia (`chainId: 84532`)
- Create a new agent (`mintAgent`)
- View registry list + strategy metrics (`healthFactor`, `totalManagedAssets`, `pendingYield`)
- One-click `performUpkeep` via "Run Agent Now"
- Direct Basescan links for deployed registry and strategy

Run locally:

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Then open `http://localhost:3000`.
