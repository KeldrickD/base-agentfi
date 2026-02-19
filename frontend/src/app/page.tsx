"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits, isAddress } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { deployedAddresses, registryAbi, strategyAbi } from "@/lib/contracts";

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

export default function Home() {
  const publicClient = usePublicClient();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { writeContractAsync, isPending: isWritePending } = useWriteContract();

  const [status, setStatus] = useState("Ready");
  const [ownerInput, setOwnerInput] = useState("");
  const [metadataInput, setMetadataInput] = useState("ipfs://base-agentfi/agent");
  const [walletInput, setWalletInput] = useState("0x0000000000000000000000000000000000000000");
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

  const healthPct = Math.max(0, Math.min(100, healthFactorFloat * 45));

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

  async function createAgent() {
    if (!isConnected) {
      setStatus("Connect wallet before minting an agent.");
      return;
    }
    if (!isAddress(ownerInput) || !isAddress(walletInput)) {
      setStatus("Owner and linked wallet must be valid addresses.");
      return;
    }

    try {
      setStatus("Minting agent...");
      const hash = await writeContractAsync({
        address: deployedAddresses.registry,
        abi: registryAbi,
        functionName: "mintAgent",
        args: [ownerInput as `0x${string}`, metadataInput, walletInput as `0x${string}`],
      });

      await publicClient?.waitForTransactionReceipt({ hash });
      setStatus(`Agent minted. Tx: ${hash}`);
    } catch (error) {
      setStatus(`Mint failed: ${(error as Error).message}`);
    }
  }

  async function runAgentNow() {
    if (!isConnected) {
      setStatus("Connect wallet before running strategy upkeep.");
      return;
    }

    try {
      setStatus("Checking upkeep...");
      const upkeep = await publicClient?.readContract({
        address: deployedAddresses.strategy,
        abi: strategyAbi,
        functionName: "checkUpkeep",
        args: ["0x"],
      });

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
      await publicClient?.waitForTransactionReceipt({ hash });
      setStatus(`performUpkeep confirmed. Tx: ${hash}`);
    } catch (error) {
      setStatus(`performUpkeep failed: ${(error as Error).message}`);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-7xl px-6 py-10 md:px-10">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-muted">Base Sepolia • Chain 84532</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">
            AgentFi Control Center
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted">
            Coinbase-style autonomous DeFi agents for RWA strategy management.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <span className="rounded-full border border-white/20 px-4 py-2 text-sm text-white">
                {shortAddress(address)}
              </span>
              <button
                className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/10"
                onClick={() => disconnect()}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-green-400 disabled:opacity-60"
              disabled={isConnectPending}
              onClick={() => connect({ connector: connectors[0] })}
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-muted">
            Health Factor
          </p>
          <p className="mt-3 text-3xl font-semibold text-white">
            {healthFactorFloat.toFixed(3)}
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${healthPct}%` }}
            />
          </div>
        </div>

        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-muted">
            Total Managed Assets
          </p>
          <p className="mt-3 text-3xl font-semibold text-white">
            {Number(formatUnits(totalManagedAssets ?? 0n, 6)).toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted">USDC</p>
        </div>

        <div className="card p-5">
          <p className="text-xs uppercase tracking-wider text-muted">
            Pending Yield
          </p>
          <p className="mt-3 text-3xl font-semibold text-white">
            {Number(formatUnits(pendingYield ?? 0n, 6)).toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted">USDC ready to compound</p>
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-white">Create New Agent</h2>
          <p className="mt-1 text-sm text-muted">
            Mint an agent identity NFT in the registry.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block text-xs text-muted">
              Owner (EOA or smart account)
              <input
                className="mt-1 w-full rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm outline-none focus:border-accent"
                value={ownerInput}
                onChange={(e) => setOwnerInput(e.target.value)}
              />
            </label>

            <label className="block text-xs text-muted">
              Metadata URI
              <input
                className="mt-1 w-full rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm outline-none focus:border-accent"
                value={metadataInput}
                onChange={(e) => setMetadataInput(e.target.value)}
              />
            </label>

            <label className="block text-xs text-muted">
              Linked Agent Wallet (placeholder)
              <input
                className="mt-1 w-full rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm outline-none focus:border-accent"
                value={walletInput}
                onChange={(e) => setWalletInput(e.target.value)}
              />
            </label>

            <button
              className="mt-2 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black hover:bg-green-400 disabled:opacity-60"
              disabled={isWritePending}
              onClick={createAgent}
            >
              Mint Agent
            </button>
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Agent List</h2>
            <button
              className="rounded-lg border border-white/20 px-4 py-2 text-xs hover:bg-white/10 disabled:opacity-60"
              onClick={runAgentNow}
              disabled={isWritePending}
            >
              Run Agent Now
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
                  className="rounded-lg border border-white/10 bg-black/20 p-3"
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
          className="card block p-4 hover:border-accent"
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
          className="card block p-4 hover:border-accent"
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

      <footer className="mt-6 rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-xs text-muted">
        Status: {status}
      </footer>
    </main>
  );
}
