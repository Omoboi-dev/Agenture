import type { Address } from "viem";
import roster from "../../shared/startups.json" with { type: "json" };

// A startup agent pitching for capital. The pitch numbers are SELF-REPORTED and
// unverified on purpose: the judge's job is to weigh these claims against the real
// onchain signals gathered in due diligence. agentId is the startup's ERC-8004
// identity when it has one; null means it has no onchain reputation yet (cold start).
export type Startup = {
  name: string;
  wallet: Address; // the startup's Circle wallet: receives investment, signs settle()
  walletId: string; // Circle Developer Controlled Wallet id
  agentId: bigint | null;
  pitch: {
    idea: string;
    monthlyRevenueUsdc: number; // self-reported
    estimatedWorthUsdc: number; // self-reported
    askUsdc: number; // how much it wants
  };
};

// The roster lives in shared/startups.json so the frontend reads the same list and
// `bun run provision-startups` can append to it without rewriting code.
export const startups: Startup[] = roster.startups.map((s) => ({
  name: s.name,
  wallet: s.wallet as Address,
  walletId: s.walletId,
  agentId: s.agentId === null ? null : BigInt(s.agentId),
  pitch: s.pitch,
}));

export function findStartupByWallet(wallet: Address): Startup | undefined {
  const w = wallet.toLowerCase();
  return startups.find((s) => s.wallet.toLowerCase() === w);
}
