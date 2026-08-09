import roster from '@shared/startups.json'
import { customers } from '@/lib/market'
import { addresses } from '@/lib/addresses'

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

// The roster is shared with the agents: one source of truth, so the frontend can never
// show a different set of agents from the one the judges actually heard.
export const startups: StartupMeta[] = roster.startups.map((s) => ({
  name: s.name,
  wallet: s.wallet,
  agentId: s.agentId,
  pitch: s.pitch,
}))

export function startupByWallet(wallet: string): StartupMeta | undefined {
  const w = wallet.toLowerCase()
  return startups.find((s) => s.wallet.toLowerCase() === w)
}

// Whose ERC-8004 feedback counts, split by who wrote it. Mirrors agents/src/diligence.ts,
// and getSummary aggregates over exactly these lists.
//
// The split is by rater rather than by tag because a rater's incentive is the thing that
// matters and does not drift: a buyer that paid is evidence, a judge that funded the deal
// is an opinion with a position behind it.

/** Agents that paid for a service and rated what they got. */
export const marketRaters = [
  ...customers.map((c) => c.wallet).filter((w): w is string => Boolean(w)),
  '0xd4d1bae70e727c9f66c3ed0efbf7bf57b46fd92f', // the original single house customer
]

/** The fund's own side, including judges' pre-migration EOA wallets. */
export const investorRaters = [
  addresses.agenture.operator,
  ...addresses.agenture.judges.map((j) => j.wallet),
  '0x7F2733B91b12bcF2cfE99E2aa2617286b93cA7de',
  '0xf2fD1775118E21Ea5B9507235d3556C97181a9F7',
  '0x62050AB71Cd055cD48ed4fc2aD940606F7d63467',
  '0xcA76529b251502130b8AAaD091c03b72F37e0008',
]

export const allRaters = [...marketRaters, ...investorRaters]
