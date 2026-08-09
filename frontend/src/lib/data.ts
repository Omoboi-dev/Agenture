import type { Address } from 'viem'
import { publicClient } from './chain'
import { addresses } from './addresses'
import { fundAbi, reputationAbi, erc20Abi, revenueShareAbi } from './abis'
import { judgePersonas, startups, startupByWallet, marketRaters, investorRaters } from './roster'
import { customers as customerRoster } from './market'

const FUND = addresses.agenture.fund as Address
const USDC = addresses.usdc as Address
const REP = addresses.erc8004.reputationRegistry as Address

// Arc's public RPC refuses bursts. Measured against it directly: 10 concurrent calls all
// succeed, 30 loses half, 120 loses every one, each with -32005 "rate limit exceeded".
// It also returns -32011 "request limit reached" when the longer-run quota is hit.
//
// Both codes matter. Missing -32005 is what made the dashboard hang on "Reading Arc" for
// ever: the error was not recognised as retryable, so it escaped loadOverview and there
// was never any data to render.
async function withRetry<T>(fn: () => Promise<T>, tries = 7): Promise<T> {
  let delay = 700
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e)
      const code = (e as { code?: number })?.code
      const rateLimited =
        msg.includes('rate limit') || msg.includes('request limit') || msg.includes('RPC Request failed') ||
        msg.includes('429') || code === -32011 || code === -32005
      if (!rateLimited || i === tries - 1) throw e
      await new Promise((r) => setTimeout(r, delay))
      delay *= 1.8
    }
  }
  throw new Error('unreachable')
}

/**
 * Run reads a few at a time instead of all at once, retrying each one on its own.
 *
 * Firing everything into Promise.all was the other half of the hang: one poll wants about
 * 130 calls, the node drops most of them, and because the retry wrapped the whole batch a
 * single failure re-sent all 130 into the same wall. Eight at a time gets through, and a
 * call that trips the limiter now only costs itself.
 */
const CONCURRENCY = 8

async function pool<T, R>(items: T[], fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await withRetry(() => fn(items[i], i))
    }
  })
  await Promise.all(workers)
  return out
}

const lower = (xs: string[]) => Array.from(new Set(xs.map((a) => a.toLowerCase()))) as Address[]
const MARKET_CLIENTS = lower(marketRaters)
const INVESTOR_CLIENTS = lower(investorRaters)

export type FundState = {
  cash: bigint
  nav: bigint
  totalCapital: bigint
  totalDeployed: bigint
  totalReturned: bigint
  totalOutstanding: bigint
  dealCount: number
}

export type JudgeRow = {
  name: string
  label: string
  thesis: string
  wallet: string
  agentId: number
  active: boolean
  committed: bigint // capital the fund has promised, grows with the judge's returns
  called: bigint // how much of that the judge has drawn into its own wallet
  budget: bigint // USDC actually sitting in the judge's own wallet
  deployed: bigint
  returned: bigint
  roiBps: number
}

export type DealRow = {
  id: number
  judge: string
  startup: string
  startupName: string
  judgeName: string
  amount: bigint
  revenueShareBps: number
  returned: bigint
  status: number // 0 active, 1 closed
}

export type StartupRow = {
  name: string
  wallet: string
  agentId: number
  pitch: (typeof startups)[number]['pitch']
  /** Reputation, split by who wrote it. There is deliberately no blended figure: nothing
   *  should show one, and reading it cost 18 RPC calls a minute to display nowhere. `market` is buyers that paid for the
   *  service; `investor` is judges rating agents they already backed. They disagree, and
   *  the disagreement is the point: see agents/src/diligence.ts. */
  market: { count: number; value: number } | null
  investor: { count: number; value: number } | null
  balance: bigint
  /** Cumulative revenue this agent has reported across all its deals, read from
   *  RevenueShare. The only onchain record of what it actually sold. */
  revenue: bigint
}

export type CustomerRow = {
  name: string
  role: string
  budgetUsdc: number
  /** How it picks: its own past satisfaction, the public score, and price. */
  weights: { experience: number; reputation: number; price: number }
  wallet: string | null
  /** What is actually in its wallet right now. A buyer with an empty wallet is not a
   *  buyer, however good its intentions look in the roster. */
  balance: bigint
}

export type Overview = {
  fund: FundState
  judges: JudgeRow[]
  deals: DealRow[]
  startups: StartupRow[]
  customers: CustomerRow[]
}

function fund<const T extends string>(functionName: T, args?: readonly unknown[]) {
  return publicClient.readContract({ address: FUND, abi: fundAbi, functionName, args } as never)
}

const judgeName = (wallet: string) =>
  addresses.agenture.judges.find((j) => j.wallet.toLowerCase() === wallet.toLowerCase())?.name ?? 'unknown'

export async function loadOverview(): Promise<Overview> {
  // Round 1: fund scalars.
  const [cash, nav, totalCapital, totalDeployed, totalReturned, totalOutstanding, dealCountRaw] = (await pool(
    ['cash', 'nav', 'totalCapital', 'totalDeployed', 'totalReturned', 'totalOutstanding', 'dealCount'],
    (name) => fund(name),
  )) as bigint[]

  const dealCount = Number(dealCountRaw)
  const fundState: FundState = { cash, nav, totalCapital, totalDeployed, totalReturned, totalOutstanding, dealCount }

  // Round 2: everything else. One poll is about 130 calls, so they go through the pool a
  // few at a time rather than all at once.
  const judgeCfgs = addresses.agenture.judges
  const dealIds = Array.from({ length: dealCount }, (_, i) => BigInt(i))
  const funded = customerRoster.filter((c) => c.wallet)

  const summary = (agentId: number, clients: Address[]) =>
    publicClient.readContract({
      address: REP,
      abi: reputationAbi,
      functionName: 'getSummary',
      args: [BigInt(agentId), clients, '', ''],
    })
  const balanceOf = (wallet: string) =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [wallet as Address] })

  const judgeStates = await pool(judgeCfgs, (j) => fund('getJudge', [j.wallet as Address]))
  const deals = await pool(dealIds, (id) => fund('getDeal', [id]))
  const marketReps = await pool(startups, (s) => summary(s.agentId, MARKET_CLIENTS))
  const investorReps = await pool(startups, (s) => summary(s.agentId, INVESTOR_CLIENTS))
  const bals = await pool(startups, (s) => balanceOf(s.wallet))
  const judgeBals = await pool(judgeCfgs, (j) => balanceOf(j.wallet))
  // What each deal has actually sold. Only the fund's cut moves onchain, so this is the
  // one place the underlying revenue is recorded.
  const dealRevenues = await pool(dealIds, (id) =>
    publicClient.readContract({
      address: addresses.agenture.revenueShare as Address,
      abi: revenueShareAbi,
      functionName: 'reportedRevenue',
      args: [id],
    }),
  )
  const customerBals = await pool(funded, (c) => balanceOf(c.wallet as string))

  const judges: JudgeRow[] = judgeCfgs.map((j, i) => {
    const st = judgeStates[i] as { active: boolean; agentId: bigint; committed: bigint; called: bigint; deployed: bigint; returned: bigint }
    const persona = judgePersonas[j.name] ?? { label: '', thesis: '' }
    return {
      name: j.name,
      label: persona.label,
      thesis: persona.thesis,
      wallet: j.wallet,
      agentId: Number(j.agentId),
      active: st.active,
      committed: st.committed,
      called: st.called,
      budget: judgeBals[i] as bigint,
      deployed: st.deployed,
      returned: st.returned,
      roiBps: st.deployed > 0n ? Number((st.returned * 10000n) / st.deployed) : 0,
    }
  })

  const dealRows: DealRow[] = (deals as Array<{
    judge: string
    startup: string
    amount: bigint
    revenueShareBps: number
    returned: bigint
    status: number
  }>).map((d, id) => ({
    id,
    judge: d.judge,
    startup: d.startup,
    judgeName: judgeName(d.judge),
    startupName: startupByWallet(d.startup)?.name ?? 'external',
    amount: d.amount,
    revenueShareBps: Number(d.revenueShareBps),
    returned: d.returned,
    status: Number(d.status),
  }))

  const asSignal = (r: unknown) => {
    const [count, value] = r as [bigint, bigint, number]
    return Number(count) > 0 ? { count: Number(count), value: Number(value) } : null
  }

  const startupRows: StartupRow[] = startups.map((s, i) => {
    return {
      name: s.name,
      wallet: s.wallet,
      agentId: s.agentId,
      pitch: s.pitch,
      market: asSignal(marketReps[i]),
      investor: asSignal(investorReps[i]),
      balance: bals[i] as bigint,
      // Sum the reported revenue of every deal this agent holds. One agent can be backed
      // by several judges, and each of those deals meters its sales separately.
      revenue: dealRows
        .filter((d) => d.startup.toLowerCase() === s.wallet.toLowerCase())
        .reduce((sum, d) => sum + ((dealRevenues[d.id] as bigint) ?? 0n), 0n),
    }
  })

  const customerRows: CustomerRow[] = customerRoster.map((c) => {
    const i = funded.indexOf(c)
    return {
      name: c.name,
      role: c.role,
      budgetUsdc: c.budgetUsdc,
      weights: c.weights,
      wallet: c.wallet,
      balance: i === -1 ? 0n : ((customerBals[i] as bigint) ?? 0n),
    }
  })

  return { fund: fundState, judges, deals: dealRows, startups: startupRows, customers: customerRows }
}
