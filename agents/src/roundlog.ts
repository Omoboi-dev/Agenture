import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The deliberation itself is off-chain: a judge's reasoning is LLM prose, and only its
// conclusion (the invest call) lands on Arc. The frontend still needs to show what was
// said, so every round appends a record here. Onchain facts in this file are pointers
// (dealId, txHash) that the UI re-reads from the chain; the prose is the only thing
// that lives nowhere else.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUNDS_PATH = join(HERE, "../../shared/rounds.json");
const KEEP = 25;

export type Dossier = {
  name: string;
  wallet: string;
  agentId: number | null;
  reputation: { count: number; value: number } | null;
  usdcBalance: number;
  pitch: {
    idea: string;
    monthlyRevenueUsdc: number;
    estimatedWorthUsdc: number;
    askUsdc: number;
  };
};

export type Verdict = {
  judge: string; // persona key, e.g. "alpha"
  startup: string;
  invest: boolean;
  score: number;
  rationale: string;
  requestedUsdc: number;
  revenueShareBps: number;
  // What actually happened once the orchestrator clamped the ask to the real budget.
  // "no-mandate" means the judge never reviewed the pitch because it had nothing left
  // to spend; "no-budget" means it wanted in but ran out mid-round.
  outcome: "committed" | "passed" | "no-budget" | "no-mandate";
  allocatedUsdc: number;
  dealId: number | null;
  txHash: string | null;
};

export type RoundLog = {
  id: number;
  startedAt: string;
  endedAt: string;
  dryRun: boolean;
  cashBeforeUsdc: number;
  cashAfterUsdc: number;
  dossiers: Dossier[];
  verdicts: Verdict[];
};

type RoundsFile = { rounds: RoundLog[] };

export function readRounds(): RoundLog[] {
  if (!existsSync(ROUNDS_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(ROUNDS_PATH, "utf8")) as RoundsFile;
    return Array.isArray(parsed.rounds) ? parsed.rounds : [];
  } catch {
    return [];
  }
}

export function nextRoundId(): number {
  const rounds = readRounds();
  return rounds.length === 0 ? 1 : Math.max(...rounds.map((r) => r.id)) + 1;
}

// Append a round, newest last, keeping the file bounded. A dry run is recorded too, so
// a preview can be inspected in the UI, but it is flagged so nothing reads it as real.
export function appendRound(round: RoundLog): void {
  const rounds = [...readRounds(), round].slice(-KEEP);
  writeFileSync(ROUNDS_PATH, `${JSON.stringify({ rounds }, null, 2)}\n`);
}
