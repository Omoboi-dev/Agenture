import "dotenv/config";
import { formatUnits, parseUnits } from "viem";
import { loadJudges, judgeKey } from "./judges.js";
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

    for (const { startup, dd } of dossiers) {
      const budgetBase = remainingBase < cashBase ? remainingBase : cashBase;
      const remainingUsdc = Number(formatUnits(remainingBase, 6));
      const cashUsdc = Number(formatUnits(cashBase, 6));

      if (budgetBase <= 0n) {
        console.log(`  ${startup.name}: no budget left, skipping.`);
        continue;
      }

      const decision = await decide(judge, startup, dd, remainingUsdc, cashUsdc);

      if (!decision.invest) {
        console.log(`  ${startup.name}: PASS — ${decision.rationale}`);
        continue;
      }

      // Clamp again in base units so float rounding can never exceed the real budget.
      let amountBase = parseUnits(decision.amountUsdc.toFixed(6), 6);
      if (amountBase > budgetBase) amountBase = budgetBase;
      if (amountBase <= 0n) {
        console.log(`  ${startup.name}: PASS — nothing left to deploy`);
        continue;
      }

      const pitchRef = `agenture:${judge.key}:${startup.name}`;

      if (DRY_RUN) {
        console.log(
          `  ${startup.name}: WOULD INVEST ${usdc(amountBase)} @ ${decision.revenueShareBps}bps` +
            `\n    ${decision.rationale}`,
        );
        // Reflect the intended commitment so later pitches see a shrinking budget.
        remainingBase -= amountBase;
        cashBase -= amountBase;
        continue;
      }

      const { dealId, txHash } = await invest(
        judgeKey(judge),
        startup.wallet,
        amountBase,
        decision.revenueShareBps,
        pitchRef,
      );

      remainingBase -= amountBase;
      cashBase -= amountBase;

      console.log(
        `  ${startup.name}: INVEST ${usdc(amountBase)} @ ${decision.revenueShareBps}bps ` +
          `-> deal #${dealId} (tx ${txHash})\n    ${decision.rationale}`,
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
