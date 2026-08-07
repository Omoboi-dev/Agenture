import type { Address, Hex } from "viem";
import { addresses } from "./config.js";

// A judge is a seasoned entrepreneur agent with its own onchain track record and a
// spending mandate. Persona (name + investing thesis) lives here in code; the wallet,
// ERC-8004 agentId, and mandate come from shared/addresses.json; the private key is
// read from the environment at run time and never stored here.
export type JudgePersona = {
  key: string; // matches the name in addresses.json
  name: string;
  thesis: string;
  envKey: string; // env var holding this judge's private key
  // How much each part of a pitch counts for this judge. The model scores the same four
  // components for everyone; these weights are what turn one shared rubric into three
  // different opinions. Without them all three judges converge on identical verdicts,
  // because a prescriptive rubric swamps a one-line persona.
  weights: { idea: number; evidence: number; price: number; risk: number };
  // A dealbreaker or discipline this judge must obey, stated to it directly. Judgement,
  // not arithmetic, so it belongs in the prompt rather than in the weighting.
  rule: string;
  // Position sizing is enforced here rather than trusted to the prompt, because a model
  // asked politely to cap its cheque will exceed it. maxTicketPct is the most of its own
  // wallet this judge may put into any single deal; unprovenCapUsdc is a harder ceiling
  // that applies when the onchain evidence is weak.
  maxTicketPct: number;
  unprovenCapUsdc: number;
};

const personas: Record<string, JudgePersona> = {
  alpha: {
    key: "alpha",
    name: "Alpha",
    thesis:
      "Backs verifiable onchain traction and real revenue over narrative. Treats a cold-start agent " +
      "with no reputation as a real risk, not a disqualifier, but sizes those checks small. Wants a " +
      "fair revenue share and disciplined check sizes; never deploys the whole mandate into one deal.",
    envKey: "JUDGE_A_PRIVATE_KEY",
    weights: { idea: 1, evidence: 1, price: 1, risk: 1 },
    maxTicketPct: 0.15,
    unprovenCapUsdc: 2,
    rule:
      "Discipline is your edge. When the onchain evidence is thin, you may still back a good " +
      "idea, but you size it small: never more than 2 USDC into an unproven agent, however " +
      "much you like the story.",
  },
  nova: {
    key: "nova",
    name: "Nova",
    thesis:
      "A growth investor with high risk tolerance. Backs bold ideas and large addressable markets even " +
      "before revenue, betting that a few outsized winners pay for the misses. Willing to fund cold-start " +
      "agents, but demands a larger revenue share to price the risk. Moves decisively on conviction.",
    envKey: "JUDGE_B_PRIVATE_KEY",
    weights: { idea: 2, evidence: 0.5, price: 1, risk: 0.75 },
    maxTicketPct: 0.3,
    unprovenCapUsdc: 5,
    rule:
      "You back unproven agents on purpose, because that is where the outsized returns are. " +
      "But you never do it cheaply: when there is little or no onchain evidence, demand at " +
      "least 1500 bps of revenue share to price what you are taking on.",
  },
  sable: {
    key: "sable",
    name: "Sable",
    thesis:
      "A conservative value investor. Only backs startups with proven revenue and real onchain reputation; " +
      "passes on pre-revenue or unproven agents no matter how big the story. Writes small, disciplined " +
      "checks and accepts a modest revenue share in exchange for lower risk. When in doubt, passes.",
    envKey: "JUDGE_C_PRIVATE_KEY",
    weights: { idea: 0.5, evidence: 2, price: 1.25, risk: 1.5 },
    maxTicketPct: 0.12,
    unprovenCapUsdc: 1,
    rule:
      "Evidence is the whole job. You do not invest where the onchain record is absent or " +
      "poor, no matter how strong the story sounds, because a story is not evidence. If the " +
      "evidence is weak, pass and say so.",
  },
};

export type Judge = JudgePersona & {
  wallet: Address; // the judge's Circle wallet address (what it signs from)
  walletId: string; // Circle Developer Controlled Wallet id
  agentId: bigint;
};

// Merge persona + on-chain config into the judges the orchestrator will run. Only
// judges that have both a persona and an addresses.json entry are included.
export function loadJudges(): Judge[] {
  const out: Judge[] = [];
  for (const entry of addresses.agenture.judges) {
    const persona = personas[entry.name];
    if (!persona) continue;
    out.push({
      ...persona,
      wallet: entry.wallet as Address,
      walletId: entry.walletId,
      agentId: BigInt(entry.agentId),
    });
  }
  return out;
}

// The private key for a judge, read from the environment only when we are about to
// send a transaction. Throws a clear error if the key is missing.
export function judgeKey(judge: Judge): Hex {
  const raw = process.env[judge.envKey];
  if (!raw) throw new Error(`missing ${judge.envKey} in environment for judge ${judge.name}`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

// Find a loaded judge by its wallet address (case-insensitive), e.g. to attribute a
// deal's onchain judge back to its persona and key.
export function findJudgeByWallet(wallet: Address): Judge | undefined {
  const w = wallet.toLowerCase();
  return loadJudges().find((j) => j.wallet.toLowerCase() === w);
}
