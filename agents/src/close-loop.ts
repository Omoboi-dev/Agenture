import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient } from "./chain.js";
import { addresses } from "./config.js";
import { fundAbi } from "./abis.js";
import { findStartupByWallet } from "./startups.js";
import { findJudgeByWallet } from "./judges.js";
import { settle } from "./revenue.js";
import { giveFeedback } from "./feedback.js";
import { payViaX402 } from "./x402.js";
import { withRpcRetry } from "./chain.js";

const FUND = addresses.agenture.fund as Address;

function envKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name} in environment`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

export type Deal = {
  judge: Address;
  startup: Address;
  amount: bigint;
  revenueShareBps: number;
  returned: bigint;
  status: number;
  pitchRef: string;
};

export async function getDeal(dealId: bigint): Promise<Deal> {
  return (await withRpcRetry(() =>
    publicClient.readContract({ address: FUND, abi: fundAbi, functionName: "getDeal", args: [dealId] }),
  )) as Deal;
}

export async function dealCount(): Promise<bigint> {
  return (await withRpcRetry(() =>
    publicClient.readContract({ address: FUND, abi: fundAbi, functionName: "dealCount" }),
  )) as bigint;
}

// One full earn -> settle -> rate pass over a single deal. Returns the cut that reached
// the fund, or null if the deal could not be processed.
// How much a startup sells this cycle. Demand follows how good the business actually is,
// so a strong agent earns more per cycle than a weak one. This is a demand model standing
// in for a market of paying agents, not observed customer behaviour: what is real is that
// the payment, the revenue share and the rating all settle onchain.
export function demandFor(quality: number, base: bigint): bigint {
  const mult = 0.3 + 1.7 * Math.max(0, Math.min(1, quality));
  return (base * BigInt(Math.round(mult * 1000))) / 1000n;
}

// The rating a judge leaves reflects what the startup delivered against the best any
// agent could have. A constant score would flatten reputation into noise and make the
// whole diligence layer pointless.
export function scoreFor(revenue: bigint, base: bigint): number {
  const best = (base * 2000n) / 1000n; // the multiplier a perfect agent would earn
  if (best === 0n) return 50;
  const pct = Number((revenue * 100n) / best);
  return Math.max(5, Math.min(99, pct));
}

export async function closeDeal(
  dealId: bigint,
  operatorKey: Hex,
  revenue: bigint,
  score: number,
): Promise<bigint | null> {
  const deal = await getDeal(dealId);
  if (deal.status !== 0) {
    console.log(`Deal #${dealId}: not active, skipping.`);
    return null;
  }

  const startup = findStartupByWallet(deal.startup);
  const judge = findJudgeByWallet(deal.judge);
  if (!startup) {
    console.log(`Deal #${dealId}: unknown startup ${deal.startup}, skipping.`);
    return null;
  }
  if (!judge) {
    console.log(`Deal #${dealId}: unknown judge ${deal.judge}, skipping.`);
    return null;
  }

  const cut = (revenue * BigInt(deal.revenueShareBps)) / 10000n;
  console.log(
    `Deal #${dealId}: ${startup.name} earns ${formatUnits(revenue, 6)} USDC; ` +
      `cut ${formatUnits(cut, 6)} USDC (${deal.revenueShareBps}bps) back to ${judge.name}.`,
  );

  // 1. The customer pays the startup for its service via x402: the customer's Circle
  // wallet signs an EIP-3009 authorization, the operator settles it as facilitator.
  const customer = addresses.agenture.customer;
  await payViaX402(customer.walletId, customer.wallet as Address, operatorKey, deal.startup, revenue);
  // 2. Startup settles the fund's cut from its own Circle wallet.
  await settle(startup.walletId, dealId, revenue);
  console.log(`  settled: ${formatUnits(cut, 6)} USDC returned to the Fund.`);

  // 3. Judge rates the startup on ERC-8004 (builds reputation for next round).
  if (startup.agentId !== null) {
    try {
      await giveFeedback(judge.walletId, startup.agentId, score);
      console.log(`  ${judge.name} rated ${startup.name} (agentId ${startup.agentId}) score ${score}.`);
    } catch (e) {
      console.log(`  feedback skipped (${String((e as Error).message).split("\n")[0]}).`);
    }
  } else {
    console.log(`  ${startup.name} has no ERC-8004 identity yet; skipped feedback.`);
  }

  return cut;
}

// Close the loop on funded deals: the startup earns revenue (a customer pays it),
// settles the fund's cut back through RevenueShare, and the deal's judge leaves ERC-8004
// feedback that becomes next round's reputation signal. Operator drives the earning; the
// startup and judge sign their own parts.
async function main() {
  const operatorKey = envKey("DEPLOYER_PRIVATE_KEY");
  const revenue = parseUnits(process.env.REVENUE_USDC ?? "2", 6);
  const score = Number(process.env.FEEDBACK_SCORE ?? "82");

  // Which deals to process (default 1,2 — the first live round; deal 0 was the spike).
  const dealIds = (process.argv[2] ?? "1,2").split(",").map((s) => BigInt(s.trim()));

  console.log("=== Agenture close-loop ===\n");

  for (const dealId of dealIds) {
    await closeDeal(dealId, operatorKey, revenue, score);
  }

  console.log("\nClose-loop complete.");
}

if (process.argv[1]?.endsWith("close-loop.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
