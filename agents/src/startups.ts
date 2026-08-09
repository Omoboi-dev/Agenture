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
  // How good the business actually is, 0..1. The ground truth of the simulated world.
  // Nothing reads it except a customer's experience of a service it paid for: the
  // customer forms a private opinion, buys more or less next time, and rates the seller.
  // Revenue and reputation are downstream of those decisions, never of this number
  // directly. Judges never see it, and neither does anyone who has not bought.
  quality: number;
  // What the agent sells, when it wants to say so itself. Both fields are optional:
  // catalog.ts infers a sector from the pitch and a price from the ask otherwise.
  service?: { sectors?: string[]; unitPriceUsdc?: number };
};

// The roster lives in shared/startups.json so the frontend reads the same list and
// `bun run provision-startups` can append to it without rewriting code.
export const startups: Startup[] = roster.startups.map((s) => ({
  name: s.name,
  wallet: s.wallet as Address,
  walletId: s.walletId,
  agentId: s.agentId === null ? null : BigInt(s.agentId),
  pitch: s.pitch,
  quality: typeof (s as { quality?: number }).quality === "number" ? (s as { quality: number }).quality : 0.5,
  service: (s as { service?: Startup["service"] }).service,
}));

export function findStartupByWallet(wallet: Address): Startup | undefined {
  const w = wallet.toLowerCase();
  return startups.find((s) => s.wallet.toLowerCase() === w);
}
