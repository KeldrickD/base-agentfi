# Agent Scripts (Coinbase Agentic Wallets)

This folder demonstrates the offchain autonomy side of AgentFi using Coinbase Agentic Wallet CLI concepts plus onchain strategy calls.

## Install

```bash
cd agent-scripts
npm install
```

Install Coinbase skills:

```bash
npx skills add coinbase/agentic-wallet-skills
```

## Configure

1. Copy env template:
   ```bash
   cp .env.example .env
   ```
2. Set:
   - `BASE_SEPOLIA_RPC_URL`
   - `PRIVATE_KEY` (testing only)
   - `AGENT_EMAIL`
   - `STRATEGY_ADDRESS` and `REGISTRY_ADDRESS` from `Deploy.s.sol` output logs
3. Optional:
   - `USDC_ADDRESS` (defaults to Base Sepolia USDC)
   - `AGENT_WALLET`
   - `USDC_FUND_AMOUNT`
   - `DRY_RUN` (recommended `true` for first run)

## Agent Flow

`index.js` runs this flow:

1. Add Agentic Wallet skills (`npx skills add coinbase/agentic-wallet-skills`)
2. Authenticate wallet via `npx awal authenticate-wallet --email ...` (best-effort stub)
3. Fund with USDC via `npx awal fund --asset USDC --network base-sepolia --amount ...` (best-effort stub)
4. Call onchain strategy:
   - `checkUpkeep("")`
   - if needed: `performUpkeep(performData)`

This matches the intended architecture:
- **Offchain agent logic** handles decisioning/auth/funding and signing
- **Onchain strategy** enforces accounting + execution rules

## Run

```bash
node index.js
```

For safe dry-run only:

```bash
DRY_RUN=true node index.js
```

## Notes

- The exact `awal` commands may change over time; script uses best-effort command stubs and continues when they fail.
- TODO: replace CLI stubs with direct CDP SDK integration for production workflows.
- This setup is focused on learning Agentic Wallet + x402-style autonomous execution patterns.
