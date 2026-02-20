#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { ethers } = require("ethers");

const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BPS_DENOMINATOR = 10_000n;
const PERFORMANCE_FEE_BPS = 1_500n; // 15%

const STRATEGY_ABI = [
  "function totalManagedAssets() view returns (uint256)",
  "function pendingYield() view returns (uint256)",
  "function getHealthFactor() view returns (uint256)",
  "function checkUpkeep(bytes) view returns (bool upkeepNeeded, bytes performData)",
  "function performUpkeep(bytes performData)",
  "function reportYield(uint256 amount)",
];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

const C = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
};

function log(color, msg) {
  console.log(`${color}${msg}${C.reset}`);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function toUsdcUnits(amountStr) {
  const n = Number(amountStr);
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.floor(n * 1_000_000));
}

function fromUsdcUnits(amount) {
  return Number(ethers.formatUnits(amount, 6));
}

function clampUsdcUnits(amount, min, max) {
  if (amount < min) return min;
  if (amount > max) return max;
  return amount;
}

function buildMockMarketConditions() {
  const now = Date.now();
  const noise = Math.sin(now / 120000) * 0.8 + Math.cos(now / 90000) * 0.6;
  const baseApr = 4.5;
  const usdcYieldApr = Number((baseApr + noise).toFixed(2));
  const rwaOpportunityScore = Math.max(1, Math.min(100, Math.round(55 + noise * 15)));
  const riskLevel = rwaOpportunityScore < 35 ? "high" : rwaOpportunityScore < 55 ? "medium" : "low";
  return { usdcYieldApr, rwaOpportunityScore, riskLevel };
}

async function callOpenAICompatible(endpoint, apiKey, model, system, user) {
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM request failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content.");
  return content;
}

async function callAnthropic(apiKey, model, system, user) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 350,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic request failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  const text = payload?.content?.[0]?.text;
  if (!text) throw new Error("Anthropic returned no text.");
  return text;
}

function tryParseDecision(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function fallbackDecision(input) {
  const pending = input.vault.pendingYieldUsdc;
  const health = input.vault.healthFactor;
  const market = input.market.usdcYieldApr;

  if (health < input.policy.minHealthFactor) {
    return {
      action: "pause",
      amountUsdc: 0,
      reason: `Health factor ${health.toFixed(3)} below minimum ${input.policy.minHealthFactor.toFixed(3)}.`,
    };
  }

  if (pending > 0.5 && health >= 1) {
    return {
      action: "compound",
      amountUsdc: 0,
      reason: "Pending yield exists and risk is acceptable. Compound now.",
    };
  }

  if (market >= 4.7) {
    const candidate = Math.max(input.policy.minReportUsdc, Math.min(input.policy.maxReportUsdc, 2));
    return {
      action: "reportYield",
      amountUsdc: candidate,
      reason: `Market APR is ${market.toFixed(2)}%. Seed additional yield for the vault.`,
    };
  }

  return {
    action: "pause",
    amountUsdc: 0,
    reason: "No strong action signal; holding this cycle.",
  };
}

async function decideAction(input) {
  const systemPrompt =
    "You are an autonomous DeFi vault operator on Base Sepolia. " +
    "Return strict JSON only: {\"action\":\"compound|reportYield|pause\",\"amountUsdc\":number,\"reason\":\"string\"}. " +
    "Respect risk guardrails and avoid over-reporting yield.";
  const userPrompt = JSON.stringify(input, null, 2);

  const openAIKey = process.env.OPENAI_API_KEY;
  const xaiKey = process.env.XAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  try {
    if (openAIKey) {
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
      const text = await callOpenAICompatible("https://api.openai.com/v1", openAIKey, model, systemPrompt, userPrompt);
      const parsed = tryParseDecision(text);
      if (parsed) return { provider: `openai:${model}`, decision: parsed };
    } else if (xaiKey) {
      const model = process.env.XAI_MODEL || "grok-2-latest";
      const text = await callOpenAICompatible("https://api.x.ai/v1", xaiKey, model, systemPrompt, userPrompt);
      const parsed = tryParseDecision(text);
      if (parsed) return { provider: `xai:${model}`, decision: parsed };
    } else if (anthropicKey) {
      const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
      const text = await callAnthropic(anthropicKey, model, systemPrompt, userPrompt);
      const parsed = tryParseDecision(text);
      if (parsed) return { provider: `anthropic:${model}`, decision: parsed };
    }
  } catch (error) {
    log(C.yellow, `[brain] LLM provider failed, using local fallback. ${error.message}`);
  }

  return { provider: "local-heuristic", decision: fallbackDecision(input) };
}

async function main() {
  const rpcUrl = requiredEnv("BASE_SEPOLIA_RPC_URL");
  const privateKey = requiredEnv("PRIVATE_KEY");
  const strategyAddress = requiredEnv("STRATEGY_ADDRESS");
  const usdcAddress = process.env.USDC_ADDRESS || BASE_SEPOLIA_USDC;

  const intervalMs = Math.max(5_000, Number(process.env.BRAIN_INTERVAL_MS || 60_000));
  const dryRun = (process.env.BRAIN_DRY_RUN || process.env.DRY_RUN || "false").toLowerCase() === "true";
  const minHealthFactor = Number(process.env.BRAIN_MIN_HEALTH_FACTOR || "1.00");
  const minReportUsdc = Number(process.env.BRAIN_MIN_REPORT_USDC || "0.5");
  const maxReportUsdc = Number(process.env.BRAIN_MAX_REPORT_USDC || "5");
  const maxWalletSpendPct = Number(process.env.BRAIN_MAX_WALLET_SPEND_PCT || "0.25");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const signer = new ethers.NonceManager(wallet);
  const strategy = new ethers.Contract(strategyAddress, STRATEGY_ABI, signer);
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, signer);

  log(C.cyan, "== Base AgentFi LLM Brain ==");
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Strategy: ${strategyAddress}`);
  console.log(`USDC: ${usdcAddress}`);
  console.log(`Interval: ${intervalMs} ms`);
  console.log(`Mode: ${dryRun ? "DRY_RUN" : "LIVE"}`);

  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      const [managedRaw, pendingRaw, healthRaw, upkeepResult, walletUsdcRaw] = await Promise.all([
        strategy.totalManagedAssets(),
        strategy.pendingYield(),
        strategy.getHealthFactor(),
        strategy.checkUpkeep("0x"),
        usdc.balanceOf(wallet.address),
      ]);

      const managedUsdc = fromUsdcUnits(managedRaw);
      const pendingUsdc = fromUsdcUnits(pendingRaw);
      const healthFactor = Number(ethers.formatUnits(healthRaw, 18));
      const walletUsdc = fromUsdcUnits(walletUsdcRaw);

      const market = buildMockMarketConditions();
      const input = {
        time: new Date().toISOString(),
        vault: {
          totalManagedUsdc: managedUsdc,
          pendingYieldUsdc: pendingUsdc,
          healthFactor,
          upkeepNeeded: upkeepResult[0],
        },
        wallet: { usdcBalance: walletUsdc },
        market,
        policy: {
          minHealthFactor,
          minReportUsdc,
          maxReportUsdc,
          maxWalletSpendPct,
        },
      };

      const { provider: llmProvider, decision } = await decideAction(input);
      const normalizedAction = String(decision?.action || "pause");
      const reason = String(decision?.reason || "No reason provided.");
      const requestedAmount = Number(decision?.amountUsdc || 0);

      log(C.magenta, `\n[brain] ${new Date().toLocaleTimeString()} | provider=${llmProvider}`);
      log(C.gray, `[state] TVL=${managedUsdc.toFixed(4)} USDC | pending=${pendingUsdc.toFixed(4)} | HF=${healthFactor.toFixed(4)} | wallet=${walletUsdc.toFixed(4)} USDC`);
      log(C.gray, `[market] APR=${market.usdcYieldApr}% | rwaScore=${market.rwaOpportunityScore} | risk=${market.riskLevel}`);
      log(C.cyan, `[decision] action=${normalizedAction} amount=${requestedAmount} | reason=${reason}`);

      if (healthFactor < minHealthFactor && normalizedAction !== "pause") {
        log(C.yellow, `[guardrail] Health factor below ${minHealthFactor}. Forcing pause.`);
        return;
      }

      if (normalizedAction === "compound") {
        if (!upkeepResult[0]) {
          log(C.yellow, "[action] Compound skipped: upkeep not needed.");
          return;
        }
        signer.reset();
        if (dryRun) {
          log(C.green, `[dry-run] Would call performUpkeep(${upkeepResult[1]})`);
          return;
        }
        const tx = await strategy.performUpkeep(upkeepResult[1]);
        log(C.green, `[action] performUpkeep submitted: ${tx.hash}`);
        await tx.wait();
        log(C.green, "[action] performUpkeep confirmed.");
        return;
      }

      if (normalizedAction === "reportYield") {
        const spendCap = Math.max(0, walletUsdc * maxWalletSpendPct);
        const boundedUsdc = Math.min(maxReportUsdc, Math.max(minReportUsdc, requestedAmount || minReportUsdc), spendCap);
        const boundedRaw = clampUsdcUnits(toUsdcUnits(String(boundedUsdc)), 1n, walletUsdcRaw);

        if (boundedRaw <= 0n) {
          log(C.yellow, "[action] reportYield skipped: wallet has insufficient USDC after safety caps.");
          return;
        }

        signer.reset();
        if (dryRun) {
          const feePreview = (boundedRaw * PERFORMANCE_FEE_BPS) / BPS_DENOMINATOR;
          log(C.green, `[dry-run] Would transfer+report ${fromUsdcUnits(boundedRaw).toFixed(4)} USDC (fee preview ${fromUsdcUnits(feePreview).toFixed(4)} USDC).`);
          return;
        }

        const fundTx = await usdc.transfer(strategyAddress, boundedRaw);
        log(C.green, `[action] fund strategy tx: ${fundTx.hash}`);
        await fundTx.wait();
        const reportTx = await strategy.reportYield(boundedRaw);
        log(C.green, `[action] reportYield tx: ${reportTx.hash}`);
        await reportTx.wait();
        log(C.green, `[action] Yield funded + reported (${fromUsdcUnits(boundedRaw).toFixed(4)} USDC).`);
        return;
      }

      log(C.gray, "[action] Pause this cycle.");
    } catch (error) {
      if (error?.code === "NONCE_EXPIRED" || error?.code === "REPLACEMENT_UNDERPRICED") {
        signer.reset();
      }
      log(C.red, `[brain] cycle failed: ${error.message}`);
    } finally {
      running = false;
    }
  };

  await tick();
  setInterval(tick, intervalMs);
}

main().catch((error) => {
  log(C.red, `brain failed: ${error.message}`);
  process.exit(1);
});
