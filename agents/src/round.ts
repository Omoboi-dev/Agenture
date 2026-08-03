import "dotenv/config";
import { formatUnits, parseUnits } from "viem";
import { loadJudges } from "./judges.js";
import { startups } from "./startups.js";
import { gatherDiligence } from "./diligence.js";
import { decide } from "./judge.js";
import { getJudgeState, fundCash, invest, judgeBudget } from "./fund.js";
import { appendRound, nextRoundId, type Dossier, type Verdict } from "./roundlog.js";
import { readPositions, pickCohort, describeStage } from "./lifecycle.js";

const usdc = (base: bigint) => `${formatUnits(base, 6)} USDC`;
const human = (base: bigint) => Number(formatUnits(base, 6));
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
// How many pitches a single round hears. Small enough that a round stays readable.
const COHORT_SIZE = Number(process.env.COHORT_SIZE ?? "4");
// On Arc gas is USDC, so a judge that deploys its entire balance cannot pay for the
// transaction that deploys it. Hold a little back.
const GAS_RESERVE = parseUnits(process.env.JUDGE_GAS_RESERVE_USDC ?? "0.5", 6);

// The public Arc RPC throttles bursts, so we pace onchain reads instead of firing them
// all at once.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One autonomous round: every judge hears every startup pitch, runs real onchain due
// diligence, decides with its LLM persona, and invests from its own wallet when it
// says yes. Read-only until a judge commits capital; nothing here touches a human.
export async function runRound(): Promise<number[]> {
  const judges = loadJudges();
  if (judges.length === 0) throw new Error("no judges configured");

  const roundId = nextRoundId();
  const startedAt = new Date().toISOString();
  const verdicts: Verdict[] = [];

  console.log(`=== Agenture round ${roundId}${DRY_RUN ? " (dry run, no capital moves)" : ""} ===\n`);

  let cashBase = await fundCash();
  const cashBeforeBase = cashBase;
  console.log(`Fund cash: ${usdc(cashBase)}\n`);

  // Only agents seeking a first cheque, plus any portfolio company that has earned a
  // follow-on. A funded startup goes and runs its business instead of re-pitching.
  const positions = await readPositions();
  const cohort = pickCohort(positions, COHORT_SIZE);
  if (cohort.length === 0) {
    // Every agent is already funded and none has earned a follow-on yet. Recording an
    // empty round would just be noise in the archive.
    console.log("No startup is seeking capital this round; nothing to hear.\n");
    return [];
  }

  // Diligence is the same for every judge, so gather it once per startup up front.
  // Sequential + paced to stay under the public RPC's burst limit.
  const dossiers: { startup: (typeof startups)[number]; dd: Awaited<ReturnType<typeof gatherDiligence>> }[] = [];
  for (const p of cohort) {
    dossiers.push({ startup: p.startup, dd: await gatherDiligence(p.startup) });
    await sleep(400);
  }

  const seekingCount = positions.filter((p) => p.stage === "seeking").length;
  console.log(
    `Cohort: ${cohort.length} of ${positions.length} agents ` +
      `(${seekingCount} still seeking a first raise, ${positions.filter((p) => p.stage === "portfolio").length} in portfolio)`,
  );
  for (const p of cohort) {
    const dd = dossiers.find((d) => d.startup.name === p.startup.name)?.dd;
    const rep = dd?.reputation ? `${dd.reputation.count} ratings @ ${dd.reputation.value}` : "cold start";
    console.log(`Diligence — ${p.startup.name} [${describeStage(p)}]: reputation ${rep}, wallet holds ${dd?.usdcBalance ?? 0} USDC`);
  }
  console.log("");

  for (const judge of judges) {
    const state = await getJudgeState(judge.wallet);
    if (!state.active) {
      console.log(`Judge ${judge.name}: not active onchain, skipping.\n`);
      continue;
    }

    // A judge spends its own wallet. There is no shared pot to run dry and no mandate
    // ceiling: what it holds is what it can deploy.
    const heldBase = await judgeBudget(judge.wallet);
    let remainingBase = heldBase > GAS_RESERVE ? heldBase - GAS_RESERVE : 0n;
    console.log(
      `--- Judge ${judge.name} --- holds ${usdc(heldBase)} (${usdc(remainingBase)} investable), ` +
        `allocated ${usdc(state.allocated)}, deployed so far ${usdc(state.deployed)}`,
    );

    const record = (
      startup: (typeof startups)[number],
      decision: Awaited<ReturnType<typeof decide>>,
      outcome: Verdict["outcome"],
      allocatedUsdc = 0,
      dealId: number | null = null,
      txHash: string | null = null,
    ) => {
      verdicts.push({
        judge: judge.key,
        startup: startup.name,
        invest: decision.invest,
        score: decision.score,
        rationale: decision.rationale,
        requestedUsdc: decision.amountUsdc,
        revenueShareBps: decision.revenueShareBps,
        outcome,
        allocatedUsdc,
        dealId,
        txHash,
      });
    };

    // A judge with nothing left to spend is not asked for an opinion: prompting it with a
    // zero budget only produces a pass that reads like a rejection it never made.
    const budgetBase = remainingBase;
    if (budgetBase <= 0n) {
      const why = "its wallet is empty; awaiting an allocation from the fund";
      console.log(`  no capital to allocate this round (${why}); skipping pitches.\n`);
      for (const { startup } of dossiers) {
        record(
          startup,
          { invest: false, amountUsdc: 0, revenueShareBps: 0, score: 0, rationale: why },
          "no-mandate",
        );
      }
      continue;
    }

    // First hear every pitch, then allocate scarce mandate to the highest-conviction
    // deals. The judge sees its full remaining budget for each decision; ranking is what
    // decides which deals actually get funded when the budget runs out.
    const remainingUsdc = Number(formatUnits(remainingBase, 6));
    const cashUsdc = remainingUsdc;

    const decisions: { startup: (typeof startups)[number]; decision: Awaited<ReturnType<typeof decide>> }[] = [];
    for (const { startup, dd } of dossiers) {
      decisions.push({ startup, decision: await decide(judge, startup, dd, remainingUsdc, cashUsdc) });
    }

    const wants = decisions.filter((d) => d.decision.invest).sort((a, b) => b.decision.score - a.decision.score);
    const passes = decisions.filter((d) => !d.decision.invest);

    for (const { startup, decision } of passes) {
      console.log(`  ${startup.name}: PASS (score ${decision.score}) — ${decision.rationale}`);
      record(startup, decision, "passed");
    }

    for (const { startup, decision } of wants) {
      const available = remainingBase;
      if (available <= 0n) {
        console.log(`  ${startup.name}: WANTED (score ${decision.score}) but no budget left`);
        record(startup, decision, "no-budget");
        continue;
      }

      // Clamp again in base units so float rounding can never exceed the real budget.
      let amountBase = parseUnits(decision.amountUsdc.toFixed(6), 6);
      if (amountBase > available) amountBase = available;
      if (amountBase <= 0n) {
        console.log(`  ${startup.name}: WANTED (score ${decision.score}) but nothing left to deploy`);
        record(startup, decision, "no-budget");
        continue;
      }

      if (DRY_RUN) {
        console.log(
          `  ${startup.name}: WOULD INVEST ${usdc(amountBase)} @ ${decision.revenueShareBps}bps ` +
            `(score ${decision.score})\n    ${decision.rationale}`,
        );
        record(startup, decision, "committed", human(amountBase));
        remainingBase -= amountBase;
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

      record(startup, decision, "committed", human(amountBase), Number(dealId), txHash);
      remainingBase -= amountBase;

      console.log(
        `  ${startup.name}: INVEST ${usdc(amountBase)} @ ${decision.revenueShareBps}bps ` +
          `(score ${decision.score}) -> deal #${dealId} (tx ${txHash})\n    ${decision.rationale}`,
      );
    }
    console.log("");
  }

  const dossierLogs: Dossier[] = dossiers.map(({ startup, dd }) => ({
    name: startup.name,
    wallet: startup.wallet,
    agentId: startup.agentId === null ? null : Number(startup.agentId),
    reputation: dd.reputation,
    usdcBalance: dd.usdcBalance,
    pitch: startup.pitch,
  }));

  appendRound({
    id: roundId,
    startedAt,
    endedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    cashBeforeUsdc: human(cashBeforeBase),
    cashAfterUsdc: human(cashBase),
    dossiers: dossierLogs,
    verdicts,
  });

  console.log(
    DRY_RUN
      ? `Dry run complete. Projected fund cash after these deals: ${usdc(cashBase)}`
      : `Round complete. Fund cash now: ${usdc(cashBase)}`,
  );
  console.log(`Round ${roundId} recorded in shared/rounds.json (${verdicts.length} verdicts).`);

  return verdicts.filter((v) => v.dealId !== null).map((v) => v.dealId as number);
}

// Only self-run when invoked directly (`bun run round`); cycle.ts imports runRound.
if (process.argv[1]?.endsWith("round.ts")) {
  runRound().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
