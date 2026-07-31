// Display metadata that mirrors the agents' config (personas + pitches). Onchain facts
// (mandates, deals, reputation, balances) are read live; this is the human-facing copy.

export const judgePersonas: Record<string, { label: string; thesis: string }> = {
  alpha: {
    label: 'Proven traction',
    thesis: 'Backs verifiable onchain traction and real revenue. Disciplined check sizes, never all-in on one deal.',
  },
  nova: {
    label: 'Growth',
    thesis: 'High risk tolerance. Funds bold, large-market bets even pre-revenue, and prices the risk with a bigger revenue share.',
  },
  sable: {
    label: 'Conservative value',
    thesis: 'Only backs proven revenue and real reputation. Passes on cold starts. Small, disciplined checks. When in doubt, passes.',
  },
}

// One cobalt ramp per judge, reused everywhere a judge is identified (donut, rows,
// committee cards) so a colour always means the same judge.
const JUDGE_COLORS: Record<string, string> = {
  alpha: '#b6c4ff',
  nova: '#8fa0ea',
  sable: '#6172b4',
}
export const judgeColor = (name: string) => JUDGE_COLORS[name.toLowerCase()] ?? '#8f909d'

export type StartupMeta = {
  name: string
  wallet: string
  agentId: number
  pitch: { idea: string; monthlyRevenueUsdc: number; estimatedWorthUsdc: number; askUsdc: number }
}

export const startups: StartupMeta[] = [
  {
    name: 'MeshRelay',
    wallet: '0xa4d99d25a286d22b5750854f670ce03b84054aba',
    agentId: 851590,
    pitch: {
      idea: 'An x402 relayer that batches gasless USDC payments for other agents on Arc and takes a thin fee per settled payment.',
      monthlyRevenueUsdc: 1200,
      estimatedWorthUsdc: 40000,
      askUsdc: 3,
    },
  },
  {
    name: 'PixelForge',
    wallet: '0x043ce85e81adfb6adaead53351cd3db20891e964',
    agentId: 851661,
    pitch: {
      idea: 'A generative image agent that sells renders to other agents. Pre-revenue but claims a large addressable market.',
      monthlyRevenueUsdc: 0,
      estimatedWorthUsdc: 250000,
      askUsdc: 5,
    },
  },
  {
    name: 'DataOracle',
    wallet: '0xa447673b7a01dbb90272fcb5e3d775a0e58d7bc0',
    agentId: 851662,
    pitch: {
      idea: 'A price and event data feed for trading agents, charging per query over x402. Some early paying users, no onchain record yet.',
      monthlyRevenueUsdc: 300,
      estimatedWorthUsdc: 15000,
      askUsdc: 2,
    },
  },
]

export function startupByWallet(wallet: string): StartupMeta | undefined {
  const w = wallet.toLowerCase()
  return startups.find((s) => s.wallet.toLowerCase() === w)
}

// The raters whose ERC-8004 feedback the fund trusts: operator + judges + historical
// pre-migration wallets. Mirrors the agents' diligence set.
export const historicalRaters = [
  '0x7F2733B91b12bcF2cfE99E2aa2617286b93cA7de',
  '0xf2fD1775118E21Ea5B9507235d3556C97181a9F7',
  '0x62050AB71Cd055cD48ed4fc2aD940606F7d63467',
  '0xcA76529b251502130b8AAaD091c03b72F37e0008',
]
