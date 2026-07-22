import type { Address, Hex } from "viem";

// A startup agent pitching for capital. The pitch numbers are SELF-REPORTED and
// unverified on purpose: the judge's job is to weigh these claims against the real
// onchain signals gathered in due diligence. agentId is the startup's ERC-8004
// identity when it has one; null means it has no onchain reputation yet (cold start).
export type Startup = {
  name: string;
  wallet: Address; // where investment USDC is sent, and the deal's revenue source
  keyEnv: string; // env var holding this startup's key (for settling revenue later)
  agentId: bigint | null;
  pitch: {
    idea: string;
    monthlyRevenueUsdc: number; // self-reported
    estimatedWorthUsdc: number; // self-reported
    askUsdc: number; // how much it wants
  };
};

// Fixture roster for the demo. MeshRelay carries a real ERC-8004 agentId that already
// has onchain feedback from the Phase 0 spike, so its due diligence returns genuine
// reputation. The others are cold-start, so the judge sees claims with nothing onchain
// to back them.
export const startups: Startup[] = [
  {
    name: "MeshRelay",
    wallet: "0xcA76529b251502130b8AAaD091c03b72F37e0008",
    keyEnv: "CLIENT_PRIVATE_KEY",
    agentId: 851590n,
    pitch: {
      idea: "An x402 relayer that batches gasless USDC payments for other agents on Arc and takes a thin fee per settled payment.",
      monthlyRevenueUsdc: 1200,
      estimatedWorthUsdc: 40000,
      askUsdc: 3,
    },
  },
  {
    name: "PixelForge",
    wallet: "0x8A2cf1406e8eF32D7AeAc685303D3eeC08f48267",
    keyEnv: "STARTUP_PIXELFORGE_PRIVATE_KEY",
    agentId: 851661n,
    pitch: {
      idea: "A generative image agent that sells renders to other agents. Pre-revenue but claims a large addressable market.",
      monthlyRevenueUsdc: 0,
      estimatedWorthUsdc: 250000,
      askUsdc: 5,
    },
  },
  {
    name: "DataOracle",
    wallet: "0xC686ba6A5A41312Fd87414b707d1d04b4CeA6593",
    keyEnv: "STARTUP_DATAORACLE_PRIVATE_KEY",
    agentId: 851662n,
    pitch: {
      idea: "A price and event data feed for trading agents, charging per query over x402. Some early paying users, no onchain record yet.",
      monthlyRevenueUsdc: 300,
      estimatedWorthUsdc: 15000,
      askUsdc: 2,
    },
  },
];

export function findStartupByWallet(wallet: Address): Startup | undefined {
  const w = wallet.toLowerCase();
  return startups.find((s) => s.wallet.toLowerCase() === w);
}

// A startup's key, read from the environment only when it needs to sign (settling
// revenue). Throws a clear error if it is missing.
export function startupKey(s: Startup): Hex {
  const raw = process.env[s.keyEnv];
  if (!raw) throw new Error(`missing ${s.keyEnv} in environment for startup ${s.name}`);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}
