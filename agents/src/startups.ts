import type { Address } from "viem";

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

// Fixture roster for the demo. MeshRelay carries a real ERC-8004 agentId that already
// has onchain feedback from the Phase 0 spike, so its due diligence returns genuine
// reputation. The others are cold-start, so the judge sees claims with nothing onchain
// to back them.
export const startups: Startup[] = [
  {
    name: "MeshRelay",
    wallet: "0xa4d99d25a286d22b5750854f670ce03b84054aba",
    walletId: "0360c94d-a70d-5218-ab29-f31c989a9a80",
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
    wallet: "0x043ce85e81adfb6adaead53351cd3db20891e964",
    walletId: "e7a3de7c-49b4-5de1-9fc8-0475d0d27a7a",
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
    wallet: "0xa447673b7a01dbb90272fcb5e3d775a0e58d7bc0",
    walletId: "9244cac6-a947-5eef-b420-239e0392356e",
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
