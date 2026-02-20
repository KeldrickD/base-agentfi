"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress } from "viem";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { deployedAddresses, registryAbi, strategyAbi } from "@/lib/contracts";

const BASE_SEPOLIA_CHAIN_ID = 84532;
const STRATEGY_OWNER = (
  process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS ||
  "0x96febBA52Da1aCD9275f57dE10B39F852D83C945"
).toLowerCase();

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const strategyActionAbi = [
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "deposit",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "reportYield",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

type AgentInfo = {
  id: bigint;
  agentOwner: `0x${string}`;
  metadataURI: string;
  linkedAgentWallet: `0x${string}`;
  createdAt: bigint;
};

function shortAddress(value?: string) {
  if (!value) return "Not connected";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function useAnimatedNumber(target: number, durationMs = 650) {
  const [value, setValue] = useState(target);

  useEffect(() => {
    const start = performance.now();
    const initial = value;

    let raf = 0;
    const step = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(initial + (target - initial) * eased);
      if (progress < 1) raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
}

export default function Home() {
  const publicClient = usePublicClient();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync, isPending: isWritePending } = useWriteContract();

  const [status, setStatus] = useState("Ready");
  const [activeAction, setActiveAction] = useState<string>("");
  const [ownerInput, setOwnerInput] = useState("");
  const [metadataInput, setMetadataInput] = useState("ipfs://base-agentfi/agent");
  const [walletInput, setWalletInput] = useState("0x0000000000000000000000000000000000000000");
  const [depositAmount, setDepositAmount] = useState("1");
  const [yieldAmount, setYieldAmount] = useState("10");
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const { data: nextAgentId } = useReadContract({
    abi: registryAbi,
    address: deployedAddresses.registry,
    functionName: "nextAgentId",
    query: { refetchInterval: 8_000 },
  });

  const { data: healthFactor } = useReadContract({
    abi: strategyAbi,
    address: deployedAddresses.strategy,
    functionName: "getHealthFactor",
    query: { refetchInterval: 6_000 },
  });

  const { data: totalManagedAssets } = useReadContract({
    abi: strategyAbi,
    address: deployedAddresses.strategy,
    functionName: "totalManagedAssets",
    query: { refetchInterval: 6_000 },
  });

  const { data: pendingYield } = useReadContract({
    abi: strategyAbi,
    address: deployedAddresses.strategy,
    functionName: "pendingYield",
    query: { refetchInterval: 6_000 },
  });

  const healthFactorFloat = useMemo(() => {
    if (!healthFactor) return 0;
    return Number(formatUnits(healthFactor, 18));
  }, [healthFactor]);

  const managedFloat = Number(formatUnits(totalManagedAssets ?? 0n, 6));
  const pendingFloat = Number(formatUnits(pendingYield ?? 0n, 6));
  const animatedHealth = useAnimatedNumber(healthFactorFloat);
  const animatedManaged = useAnimatedNumber(managedFloat);
  const animatedPending = useAnimatedNumber(pendingFloat);
  const onWrongChain = chainId !== BASE_SEPOLIA_CHAIN_ID;

  const healthRing = useMemo(() => {
    const normalized = Math.max(0, Math.min(2.0, healthFactorFloat));
    const pct = Math.max(8, Math.min(100, normalized * 50));
    const color =
      healthFactorFloat > 1.2 ? "#22c55e" : healthFactorFloat >= 1 ? "#facc15" : "#ef4444";
    const circumference = 2 * Math.PI * 42;
    return {
      color,
      pct,
      dashOffset: circumference - (pct / 100) * circumference,
      circumference,
    };
  }, [healthFactorFloat]);

  const chartMax = Math.max(1, managedFloat, pendingFloat);
  const managedBar = Math.max(8, (managedFloat / chartMax) * 100);
  const pendingBar = Math.max(8, (pendingFloat / chartMax) * 100);

  useEffect(() => {
    if (!address) return;
    setOwnerInput(address);
  }, [address]);

  useEffect(() => {
    async function loadAgents() {
      if (!publicClient || !nextAgentId || nextAgentId <= 1n) {
        setAgents([]);
        return;
      }
      const loaded: AgentInfo[] = [];
      for (let i = 1n; i < nextAgentId; i++) {
        try {
          const result = (await publicClient.readContract({
            address: deployedAddresses.registry,
            abi: registryAbi,
            functionName: "getAgentInfo",
            args: [i],
          })) as {
            agentOwner: `0x${string}`;
            metadataURI: string;
            linkedAgentWallet: `0x${string}`;
            createdAt: bigint;
          };

          loaded.push({ id: i, ...result });
        } catch {
          // Ignore IDs that fail read due to burn/non-existent gaps.
        }
      }
      setAgents(loaded);
    }
    loadAgents();
  }, [publicClient, nextAgentId]);

  function parseUsdcUnits(value: string) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return BigInt(Math.floor(n * 1_000_000));
  }

  async function waitForTx(hash: `0x${string}`) {
    return publicClient?.waitForTransactionReceipt({
      hash,
      timeout: 180_000,
      pollingInterval: 2_000,
    });
  }

  async function createAgent() {
    if (!isConnected) {
      setStatus("Connect wallet before minting an agent.");
      return;
    }
    if (onWrongChain) {
      setStatus("Switch wallet network to Base Sepolia (84532).");
      return;
    }
    if (!isAddress(ownerInput) || !isAddress(walletInput)) {
      setStatus("Owner and linked wallet must be valid addresses.");
      return;
    }

    try {
      setActiveAction("mint");
      setStatus("Minting agent...");
      const hash = await writeContractAsync({
        address: deployedAddresses.registry,
        abi: registryAbi,
        functionName: "mintAgent",
        args: [ownerInput as `0x${string}`, metadataInput, walletInput as `0x${string}`],
      });

      await waitForTx(hash);
      setStatus(`Agent minted. Tx: ${hash}`);
    } catch (error) {
      setStatus(`Mint failed: ${(error as Error).message}`);
    } finally {
      setActiveAction("");
    }
  }

  async function approveUsdc() {
    if (!isConnected || !address) {
      setStatus("Connect wallet before approving USDC.");
      return;
    }
    if (onWrongChain) {
      setStatus("Switch wallet network to Base Sepolia (84532).");
      return;
    }
    const amount = parseUsdcUnits(depositAmount);
    if (!amount) {
      setStatus("Enter a valid USDC amount to approve.");
      return;
    }

    try {
      setActiveAction("approve");
      setStatus("Submitting USDC approval...");
      const hash = await writeContractAsync({
        address: deployedAddresses.asset,
        abi: erc20Abi,
        functionName: "approve",
        args: [deployedAddresses.strategy, amount],
      });
      await waitForTx(hash);
      setStatus(`USDC approved. Tx: ${hash}`);
    } catch (error) {
      setStatus(`Approve failed: ${(error as Error).message}`);
    } finally {
      setActiveAction("");
    }
  }

  async function depositUsdc() {
    if (!isConnected || !address) {
      setStatus("Connect wallet before deposit.");
      return;
    }
    if (onWrongChain) {
      setStatus("Switch wallet network to Base Sepolia (84532).");
      return;
    }
    const amount = parseUsdcUnits(depositAmount);
    if (!amount) {
      setStatus("Enter a valid USDC amount to deposit.");
      return;
    }

    try {
      setActiveAction("deposit");
      setStatus("Depositing USDC into strategy...");
      const hash = await writeContractAsync({
        address: deployedAddresses.strategy,
        abi: strategyActionAbi,
        functionName: "deposit",
        args: [amount],
      });
      await waitForTx(hash);
      setStatus(`Deposit confirmed. Tx: ${hash}`);
    } catch (error) {
      setStatus(`Deposit failed: ${(error as Error).message}`);
    } finally {
      setActiveAction("");
    }
  }

  async function reportYield() {
    if (!isConnected || !address) {
      setStatus("Connect wallet before reporting yield.");
      return;
    }
    if (onWrongChain) {
      setStatus("Switch wallet network to Base Sepolia (84532).");
      return;
    }
    const amount = parseUsdcUnits(yieldAmount);
    if (!amount) {
      setStatus("Enter a valid yield amount.");
      return;
    }

    try {
      setActiveAction("yield");
      setStatus("Reporting yield to strategy...");
      const hash = await writeContractAsync({
        address: deployedAddresses.strategy,
        abi: strategyActionAbi,
        functionName: "reportYield",
        args: [amount],
      });
      await waitForTx(hash);
      setStatus(`Yield reported. Tx: ${hash}`);
    } catch (error) {
      setStatus(`Report yield failed: ${(error as Error).message}`);
    } finally {
      setActiveAction("");
    }
  }

  async function runAgentNow() {
    if (!isConnected) {
      setStatus("Connect wallet before running strategy upkeep.");
      return;
    }
    if (onWrongChain) {
      setStatus("Switch wallet network to Base Sepolia (84532).");
      return;
    }

    try {
      setActiveAction("upkeep");
      setStatus("Checking upkeep...");
      const upkeep = (await publicClient?.readContract({
        address: deployedAddresses.strategy,
        abi: strategyAbi,
        functionName: "checkUpkeep",
        args: ["0x"],
      })) as readonly [boolean, `0x${string}`] | undefined;

      if (!upkeep || upkeep[0] === false) {
        setStatus("Upkeep not needed right now.");
        return;
      }

      setStatus("Submitting performUpkeep...");
      const hash = await writeContractAsync({
        address: deployedAddresses.strategy,
        abi: strategyAbi,
        functionName: "performUpkeep",
        args: [upkeep[1]],
      });
      await waitForTx(hash);
      setStatus(`performUpkeep confirmed. Tx: ${hash}`);
    } catch (error) {
      setStatus(`performUpkeep failed: ${(error as Error).message}`);
    } finally {
      setActiveAction("");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6 md:px-10 fade-in-up">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-3 py-1 text-xs font-medium text-green-200">
            <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_#22c55e]" />
            ● Live on Base Sepolia
          </div>
          <p className="text-sm text-muted">Base Sepolia • Chain 84532</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            AgentFi Control Center
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Coinbase-style autonomous DeFi agents for RWA strategy management.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <span className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm text-white">
                {shortAddress(address)}
              </span>
              <button
                className="rounded-lg border border-white/20 px-4 py-2 text-sm transition hover:bg-white/10"
                onClick={() => disconnect()}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-60"
              disabled={isConnectPending}
              onClick={() => connect({ connector: connectors[0] })}
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card glass-card p-5">
          <p className="metric-label">Health Factor</p>
          <div className="mt-4 flex items-center gap-4">
            <svg className="h-24 w-24 -rotate-90" viewBox="0 0 96 96">
              <circle cx="48" cy="48" r="42" stroke="rgba(255,255,255,0.12)" strokeWidth="8" fill="none" />
              <circle
                cx="48"
                cy="48"
                r="42"
                stroke={healthRing.color}
                strokeWidth="8"
                fill="none"
                strokeDasharray={healthRing.circumference}
                strokeDashoffset={healthRing.dashOffset}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            </svg>
            <div>
              <p className="metric-value">{animatedHealth.toFixed(3)}</p>
              <p className="metric-sub">
                {healthFactorFloat > 1.2
                  ? "Healthy"
                  : healthFactorFloat >= 1
                    ? "Watchlist"
                    : "At risk"}
              </p>
              <p className="mt-1 text-xs text-muted">{Math.round(healthRing.pct)}% ring fill</p>
            </div>
          </div>
        </div>

        <div className="card glass-card p-5">
          <p className="metric-label">Total Managed Assets</p>
          <p className="metric-value mt-4">{animatedManaged.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="metric-sub">USDC</p>
        </div>

        <div className="card glass-card p-5">
          <p className="metric-label">Pending Yield</p>
          <p className="metric-value mt-4">{animatedPending.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
          <p className="metric-sub">USDC ready to compound</p>
        </div>
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="card glass-card p-5">
          <p className="metric-label">📊 Strategy Snapshot</p>
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>Managed Assets</span>
                <span>{managedFloat.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC</span>
              </div>
              <div className="chart-track">
                <div className="chart-bar bg-gradient-to-r from-emerald-400 to-green-500" style={{ width: `${managedBar}%` }} />
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>Pending Yield</span>
                <span>{pendingFloat.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC</span>
              </div>
              <div className="chart-track">
                <div className="chart-bar bg-gradient-to-r from-cyan-400 to-blue-500" style={{ width: `${pendingBar}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="card glass-card p-5">
          <div className="flex items-center justify-between">
            <p className="metric-label">⚡ Quick Liquidity Action</p>
            <span className="text-xs text-muted">Approve + Deposit</span>
          </div>
          <label className="mt-3 block text-xs text-muted">
            USDC Amount
            <input
              className="form-input mt-1"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              type="number"
              min="1"
              step="1"
            />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="primary-btn"
              disabled={isWritePending || activeAction === "approve"}
              onClick={approveUsdc}
            >
              {activeAction === "approve" ? "Approving..." : "Approve USDC"}
            </button>
            <button
              className="primary-btn"
              disabled={isWritePending || activeAction === "deposit"}
              onClick={depositUsdc}
            >
              {activeAction === "deposit" ? "Depositing..." : "Deposit"}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr_1.2fr]">
        <div className="card glass-card p-6">
          <h2 className="text-lg font-semibold text-white">Create New Agent</h2>
          <p className="mt-1 text-sm text-muted">
            Mint an agent identity NFT in the registry.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block text-xs text-muted">
              Owner (EOA or smart account)
              <input
                className="form-input mt-1"
                value={ownerInput}
                onChange={(e) => setOwnerInput(e.target.value)}
              />
            </label>

            <label className="block text-xs text-muted">
              Metadata URI
              <input
                className="form-input mt-1"
                value={metadataInput}
                onChange={(e) => setMetadataInput(e.target.value)}
              />
            </label>

            <label className="block text-xs text-muted">
              Linked Agent Wallet (placeholder)
              <input
                className="form-input mt-1"
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
              />
            </label>

            <button
              className="primary-btn mt-2 w-full"
              disabled={isWritePending || activeAction === "mint"}
              onClick={createAgent}
            >
              {activeAction === "mint" ? "Minting..." : "Mint Agent"}
            </button>
          </div>
        </div>

        <div className="card glass-card p-6">
          <h2 className="text-lg font-semibold text-white">Report Yield (Owner)</h2>
          <p className="mt-1 text-sm text-muted">
            Seed strategy yield for automation demos.
          </p>
          <p className="mt-2 text-xs text-muted">
            Owner required: {shortAddress(STRATEGY_OWNER)}
          </p>
          <label className="mt-3 block text-xs text-muted">
            Yield Amount (USDC)
            <input
              className="form-input mt-1"
              value={yieldAmount}
              onChange={(e) => setYieldAmount(e.target.value)}
              type="number"
              min="0.01"
              step="0.01"
            />
          </label>
          <button
            className="primary-btn mt-3 w-full"
            disabled={isWritePending || activeAction === "yield"}
            onClick={reportYield}
            title="Report yield to strategy"
          >
            {activeAction === "yield" ? "Reporting..." : "Report Yield"}
          </button>
          <p className="mt-2 text-xs text-amber-300">
            Demo note: Owner-only in production.
          </p>
        </div>

        <div className="card glass-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Agent List</h2>
            <button
              className="primary-btn !w-auto px-4 py-2 text-xs"
              onClick={runAgentNow}
              disabled={isWritePending || activeAction === "upkeep"}
            >
              {activeAction === "upkeep" ? "Running..." : "Run Agent Now"}
            </button>
          </div>

          <p className="mt-1 text-sm text-muted">
            Registry + strategy state for autonomous operation.
          </p>

          <div className="mt-4 max-h-72 space-y-3 overflow-auto pr-1">
            {agents.length === 0 ? (
              <p className="text-sm text-muted">
                No minted agents yet. Create one to get started.
              </p>
            ) : (
              agents.map((agent) => (
                <div
                  key={agent.id.toString()}
                  className="rounded-lg border border-white/15 bg-black/25 p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white">
                      Agent #{agent.id.toString()}
                    </p>
                    <span className="text-xs text-muted">
                      {new Date(Number(agent.createdAt) * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Owner: {shortAddress(agent.agentOwner)}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted">
                    Metadata: {agent.metadataURI}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <a
          className="card glass-card block p-4 transition hover:border-accent hover:bg-white/6"
          target="_blank"
          rel="noreferrer"
          href={`https://sepolia.basescan.org/address/${deployedAddresses.registry}`}
        >
          <p className="text-xs uppercase tracking-wider text-muted">
            Registry on Basescan
          </p>
          <p className="mt-1 text-sm text-white">{deployedAddresses.registry}</p>
        </a>
        <a
          className="card glass-card block p-4 transition hover:border-accent hover:bg-white/6"
          target="_blank"
          rel="noreferrer"
          href={`https://sepolia.basescan.org/address/${deployedAddresses.strategy}`}
        >
          <p className="text-xs uppercase tracking-wider text-muted">
            Strategy on Basescan
          </p>
          <p className="mt-1 text-sm text-white">{deployedAddresses.strategy}</p>
        </a>
      </section>

      <footer
        className={`mt-6 rounded-lg border px-4 py-3 text-xs ${
          status.toLowerCase().includes("failed") || status.toLowerCase().includes("error")
            ? "border-red-400/40 bg-red-500/10 text-red-200"
            : "border-white/10 bg-black/20 text-muted"
        }`}
      >
        Status: {status}
      </footer>
    </main>
  );
}
