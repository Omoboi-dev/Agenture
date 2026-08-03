import file from '@shared/rounds.json'

// A judge's reasoning is off-chain prose: only its conclusion (the invest call) lands on
// Arc. `bun run round` writes each deliberation here, and the UI re-reads the onchain
// half (deals, balances, reputation) live. Types mirror agents/src/roundlog.ts.

export type Dossier = {
  name: string
  wallet: string
  agentId: number | null
  reputation: { count: number; value: number } | null
  usdcBalance: number
  pitch: { idea: string; monthlyRevenueUsdc: number; estimatedWorthUsdc: number; askUsdc: number }
}

export type Verdict = {
  judge: string
  startup: string
  invest: boolean
  score: number
  /** How the conviction was built up: idea /30, evidence /30, price /20, risk /20. */
  breakdown?: { idea: number; evidence: number; price: number; risk: number } | null
  rationale: string
  requestedUsdc: number
  revenueShareBps: number
  outcome: 'committed' | 'passed' | 'no-budget' | 'no-mandate'
  allocatedUsdc: number
  dealId: number | null
  txHash: string | null
}

export type RoundLog = {
  id: number
  startedAt: string
  endedAt: string
  dryRun: boolean
  cashBeforeUsdc: number
  cashAfterUsdc: number
  dossiers: Dossier[]
  verdicts: Verdict[]
}

export const rounds = ((file as { rounds?: RoundLog[] }).rounds ?? []).slice().sort((a, b) => b.id - a.id)

/** Newest round first; undefined until a round has been run. */
export const latestRound: RoundLog | undefined = rounds[0]

// Commitments first, then genuine passes, then judges that had nothing to spend.
const VERDICT_ORDER: Record<Verdict['outcome'], number> = { committed: 0, 'no-budget': 1, passed: 2, 'no-mandate': 3 }

export function verdictsFor(round: RoundLog, startup: string): Verdict[] {
  return round.verdicts
    .filter((v) => v.startup === startup)
    .sort((a, b) => VERDICT_ORDER[a.outcome] - VERDICT_ORDER[b.outcome] || b.score - a.score)
}

export function dossierFor(round: RoundLog, startup: string): Dossier | undefined {
  return round.dossiers.find((d) => d.name === startup)
}

/** Every verdict matching a startup and/or judge, newest round first, with its round. */
export function verdictHistory(filter: { startup?: string; judge?: string }): { round: RoundLog; verdict: Verdict }[] {
  const out: { round: RoundLog; verdict: Verdict }[] = []
  for (const round of rounds) {
    for (const verdict of round.verdicts) {
      if (filter.startup && verdict.startup !== filter.startup) continue
      if (filter.judge && verdict.judge !== filter.judge) continue
      out.push({ round, verdict })
    }
  }
  return out
}

/** The most recent diligence snapshot recorded for a startup. */
export function latestDossier(startup: string): Dossier | undefined {
  for (const round of rounds) {
    const d = round.dossiers.find((x) => x.name === startup)
    if (d) return d
  }
  return undefined
}

/** Total USDC a round actually deployed. */
export function roundAllocated(round: RoundLog): number {
  return round.verdicts.reduce((a, v) => a + (v.outcome === 'committed' ? v.allocatedUsdc : 0), 0)
}
