import "dotenv/config";
import type { Address, Hex } from "viem";
import { formatUnits, parseUnits } from "viem";
import { publicClient } from "./chain.js";
import { addresses } from "./config.js";
import { fundAbi } from "./abis.js";
import { findStartupByWallet, startupKey } from "./startups.js";
import { findJudgeByWallet, judgeKey } from "./judges.js";
import { payRevenue, settle } from "./revenue.js";
import { giveFeedback } from "./feedback.js";
import { withRpcRetry } from "./chain.js";

const FUND = addresses.agenture.fund as Address;

function envKey(name: string): Hex {
  const raw = process.env[name];
  if (!raw) throw new Error(`missing ${name} in environment`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

type Deal = {
  judge: Address;
  startup: Address;
  amount: bigint;
  revenueShareBps: number;
  returned: bigint;
  status: number;
  pitchRef: string;
};

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
    const deal = (await withRpcRetry(() =>
      publicClient.readContract({ address: FUND, abi: fundAbi, functionName: "getDeal", args: [dealId] }),
    )) as Deal;

    if (deal.status !== 0) {
      console.log(`Deal #${dealId}: not active, skipping.`);
      continue;
    }

    const startup = findStartupByWallet(deal.startup);
    const judge = findJudgeByWallet(deal.judge);
    if (!startup) {
      console.log(`Deal #${dealId}: unknown startup ${deal.startup}, skipping.`);
      continue;
    }
    if (!judge) {
      console.log(`Deal #${dealId}: unknown judge ${deal.judge}, skipping.`);
      continue;
    }

    const cut = (revenue * BigInt(deal.revenueShareBps)) / 10000n;
    console.log(
      `Deal #${dealId}: ${startup.name} earns ${formatUnits(revenue, 6)} USDC; ` +
        `cut ${formatUnits(cut, 6)} USDC (${deal.revenueShareBps}bps) back to ${judge.name}.`,
    );

    // 1. Customer pays the startup (stand-in for x402 revenue).
    await payRevenue(operatorKey, deal.startup, revenue);
    // 2. Startup settles the fund's cut.
    await settle(startupKey(startup), dealId, revenue);
    console.log(`  settled: ${formatUnits(cut, 6)} USDC returned to the Fund.`);

    // 3. Judge rates the startup on ERC-8004 (builds reputation for next round).
    if (startup.agentId !== null) {
      await giveFeedback(judgeKey(judge), startup.agentId, score);
      console.log(`  ${judge.name} rated ${startup.name} (agentId ${startup.agentId}) score ${score}.`);
    } else {
      console.log(`  ${startup.name} has no ERC-8004 identity yet; skipped feedback.`);
    }
  }

  console.log("\nClose-loop complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
