import "dotenv/config";
import { formatUnits, parseUnits } from "viem";
import { loadJudges } from "./judges.js";
import { startups } from "./startups.js";
import { gatherDiligence } from "./diligence.js";
import { decide } from "./judge.js";
import { getJudgeState, fundCash, invest } from "./fund.js";

const usdc = (base: bigint) => `${formatUnits(base, 6)} USDC`;
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

// The public Arc RPC throttles bursts, so we pace onchain reads instead of firing them
// all at once.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One autonomous round: every judge hears every startup pitch, runs real onchain due
// diligence, decides with its LLM persona, and invests from its own wallet when it
// says yes. Read-only until a judge commits capital; nothing here touches a human.
async function runRound() {
  const judges = loadJudges();
  if (judges.length === 0) throw new Error("no judges configured");

  console.log(`=== Agenture round${DRY_RUN ? " (dry run, no capital moves)" : ""} ===\n`);

  let cashBase = await fundCash();
  console.log(`Fund cash: ${usdc(cashBase)}\n`);

  // Diligence is the same for every judge, so gather it once per startup up front.
  // Sequential + paced to stay under the public RPC's burst limit.
  const dossiers: { startup: (typeof startups)[number]; dd: Awaited<ReturnType<typeof gatherDiligence>> }[] = [];
  for (const s of startups) {
    dossiers.push({ startup: s, dd: await gatherDiligence(s) });
    await sleep(400);
  }

  for (const { startup, dd } of dossiers) {
    const rep = dd.reputation
      ? `${dd.reputation.count} ratings @ ${dd.reputation.value}`
      : "cold start";
    console.log(`Diligence — ${startup.name}: reputation ${rep}, wallet holds ${dd.usdcBalance} USDC`);
  }
  console.log("");

  for (const judge of judges) {
    const state = await getJudgeState(judge.wallet);
    if (!state.active) {
      console.log(`Judge ${judge.name}: not active onchain, skipping.\n`);
      continue;
    }

    let remainingBase = state.mandate - state.deployed;
    console.log(
      `--- Judge ${judge.name} --- mandate ${usdc(state.mandate)}, ` +
        `deployed ${usdc(state.deployed)}, remaining ${usdc(remainingBase)}`,
    );

    // First hear every pitch, then allocate scarce mandate to the highest-conviction
    // deals. The judge sees its full remaining budget for each decision; ranking is what
    // decides which deals actually get funded when the budget runs out.
    const remainingUsdc = Number(formatUnits(remainingBase, 6));
    const cashUsdc = Number(formatUnits(cashBase, 6));

    const decisions = [];
    for (const { startup, dd } of dossiers) {
      decisions.push({ startup, decision: await decide(judge, startup, dd, remainingUsdc, cashUsdc) });
    }

    const wants = decisions.filter((d) => d.decision.invest).sort((a, b) => b.decision.score - a.decision.score);
    const passes = decisions.filter((d) => !d.decision.invest);

    for (const { startup, decision } of passes) {
      console.log(`  ${startup.name}: PASS (score ${decision.score}) — ${decision.rationale}`);
    }

    for (const { startup, decision } of wants) {
      const budgetBase = remainingBase < cashBase ? remainingBase : cashBase;
      if (budgetBase <= 0n) {
        console.log(`  ${startup.name}: WANTED (score ${decision.score}) but no budget left`);
        continue;
      }

      // Clamp again in base units so float rounding can never exceed the real budget.
      let amountBase = parseUnits(decision.amountUsdc.toFixed(6), 6);
      if (amountBase > budgetBase) amountBase = budgetBase;
      if (amountBase <= 0n) {
        console.log(`  ${startup.name}: WANTED (score ${decision.score}) but nothing left to deploy`);
        continue;
      }

      if (DRY_RUN) {
        console.log(
          `  ${startup.name}: WOULD INVEST ${usdc(amountBase)} @ ${decision.revenueShareBps}bps ` +
            `(score ${decision.score})\n    ${decision.rationale}`,
        );
        remainingBase -= amountBase;
        cashBase -= amountBase;
        continue;
      }

      const pitchRef = `agenture:${judge.key}:${startup.name}`;
      const { dealId, txHash } = await invest(
        judge.walletId,
        startup.wallet,
        amountBase,
        decision.revenueShareBps,
        pitchRef,
      );

      remainingBase -= amountBase;
      cashBase -= amountBase;

      console.log(
        `  ${startup.name}: INVEST ${usdc(amountBase)} @ ${decision.revenueShareBps}bps ` +
          `(score ${decision.score}) -> deal #${dealId} (tx ${txHash})\n    ${decision.rationale}`,
      );
    }
    console.log("");
  }

  console.log(
    DRY_RUN
      ? `Dry run complete. Projected fund cash after these deals: ${usdc(cashBase)}`
      : `Round complete. Fund cash now: ${usdc(cashBase)}`,
  );
}

runRound().catch((err) => {
  console.error(err);
  process.exit(1);
});
