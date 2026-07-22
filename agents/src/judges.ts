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
  },
};

export type Judge = JudgePersona & {
  wallet: Address;
  agentId: bigint;
  mandate: bigint; // base units (6dp)
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
      agentId: BigInt(entry.agentId),
      mandate: BigInt(entry.mandate),
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
