#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawnSync } = require("child_process");
const { ethers } = require("ethers");

const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const STRATEGY_ABI = [
  "function checkUpkeep(bytes checkData) external view returns (bool upkeepNeeded, bytes performData)",
  "function performUpkeep(bytes performData) external",
];

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function runAwal(args, options = {}) {
  const { allowFail = false, dryRun = false } = options;
  const fullCommand = `npx ${args.join(" ")}`;

  console.log(`\n$ ${fullCommand}`);
  if (dryRun) {
    console.log("DRY_RUN=true -> command skipped");
    return { ok: true, stdout: "", stderr: "" };
  }

  const result = spawnSync("npx", args, { stdio: "pipe", encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const ok = result.status === 0;
  if (!ok && !allowFail) {
    throw new Error(`Command failed (${result.status}): ${fullCommand}`);
  }
  return { ok, stdout: result.stdout || "", stderr: result.stderr || "" };
}

async function fundWithUsdcFallbackIfConfigured(provider, signer, agentWallet, amount) {
  if (!agentWallet) return;
  const usdc = new ethers.Contract(
    process.env.USDC_ADDRESS || BASE_SEPOLIA_USDC,
    ERC20_ABI,
    signer
  );

  try {
    const decimals = await usdc.decimals();
    const parsedAmount = ethers.parseUnits(amount, decimals);
    const tx = await usdc.transfer(agentWallet, parsedAmount);
    await tx.wait();
    console.log(`Fallback USDC transfer sent to agent wallet: ${tx.hash}`);
  } catch (error) {
    console.warn("Fallback USDC transfer skipped/failed:", error.message);
  }
}

async function main() {
  const rpcUrl = requiredEnv("BASE_SEPOLIA_RPC_URL");
  const privateKey = requiredEnv("PRIVATE_KEY");
  const strategyAddress = requiredEnv("STRATEGY_ADDRESS");

  const agentEmail = process.env.AGENT_EMAIL || "";
  const agentWallet = process.env.AGENT_WALLET || "";
  const usdcFundAmount = process.env.USDC_FUND_AMOUNT || "1.0";
  const dryRun = (process.env.DRY_RUN || "false").toLowerCase() === "true";

  console.log("== Base AgentFi Agent Runner ==");
  console.log("Network: Base Sepolia");
  console.log("Strategy:", strategyAddress);
  console.log("USDC:", process.env.USDC_ADDRESS || BASE_SEPOLIA_USDC);

  // Coinbase Agentic Wallet CLI flow (command shapes may evolve).
  // TODO: integrate awal CLI or CDP SDK for agent wallet actions with production auth flow.
  runAwal(["skills", "add", "coinbase/agentic-wallet-skills"], { allowFail: true, dryRun });

  if (agentEmail) {
    runAwal(["awal", "authenticate-wallet", "--email", agentEmail], {
      allowFail: true,
      dryRun,
    });
  } else {
    console.log("AGENT_EMAIL is not set. Skipping wallet auth command.");
  }

  runAwal(
    ["awal", "fund", "--asset", "USDC", "--network", "base-sepolia", "--amount", usdcFundAmount],
    { allowFail: true, dryRun }
  );

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const strategy = new ethers.Contract(strategyAddress, STRATEGY_ABI, signer);

  await fundWithUsdcFallbackIfConfigured(provider, signer, agentWallet, usdcFundAmount);

  const [upkeepNeeded, performData] = await strategy.checkUpkeep("0x");
  console.log("checkUpkeep ->", upkeepNeeded ? "needed" : "not-needed");

  if (!upkeepNeeded) {
    console.log("No upkeep needed. Exiting cleanly.");
    return;
  }

  const tx = await strategy.performUpkeep(performData);
  console.log("performUpkeep tx submitted:", tx.hash);
  await tx.wait();
  console.log("performUpkeep confirmed.");
}

main().catch((error) => {
  console.error("Agent script failed:", error);
  process.exit(1);
});
