import type { Address } from 'viem'
import { publicClient } from './chain'
import { addresses } from './addresses'
import { fundAbi, reputationAbi, erc20Abi, revenueShareAbi } from './abis'
import { judgePersonas, startups, startupByWallet, historicalRaters } from './roster'

const FUND = addresses.agenture.fund as Address
const USDC = addresses.usdc as Address
const REP = addresses.erc8004.reputationRegistry as Address

// Arc's public RPC has a tight quota and returns -32011 "request limit reached" on
// bursts. Retry the affected batch with backoff so a poll recovers on its own.
async function withRetry<T>(fn: () => Promise<T>, tries = 7): Promise<T> {
  let delay = 900
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e)
      const rateLimited =
        msg.includes('request limit') || msg.includes('RPC Request failed') || msg.includes('429') ||
        (e as { code?: number })?.code === -32011
      if (!rateLimited || i === tries - 1) throw e
      await new Promise((r) => setTimeout(r, delay))
      delay *= 1.8
    }
  }
  throw new Error('unreachable')
}

const KNOWN_CLIENTS = Array.from(
  new Set(
    [addresses.agenture.operator, ...addresses.agenture.judges.map((j) => j.wallet), ...historicalRaters].map((a) =>
      a.toLowerCase(),
    ),
  ),
) as Address[]

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
  reputation: { count: number; value: number } | null
  balance: bigint
  /** Cumulative revenue this agent has reported across all its deals, read from
   *  RevenueShare. The only onchain record of what it actually sold. */
  revenue: bigint
}

export type Overview = {
  fund: FundState
  judges: JudgeRow[]
  deals: DealRow[]
  startups: StartupRow[]
}

function fund<const T extends string>(functionName: T, args?: readonly unknown[]) {
  return publicClient.readContract({ address: FUND, abi: fundAbi, functionName, args } as never)
}

const judgeName = (wallet: string) =>
  addresses.agenture.judges.find((j) => j.wallet.toLowerCase() === wallet.toLowerCase())?.name ?? 'unknown'

export async function loadOverview(): Promise<Overview> {
  // Round 1 (batched): fund scalars.
  const [cash, nav, totalCapital, totalDeployed, totalReturned, totalOutstanding, dealCountRaw] = (await withRetry(() =>
    Promise.all([
      fund('cash'),
      fund('nav'),
      fund('totalCapital'),
      fund('totalDeployed'),
      fund('totalReturned'),
      fund('totalOutstanding'),
      fund('dealCount'),
    ]),
  )) as bigint[]

  const dealCount = Number(dealCountRaw)
  const fundState: FundState = { cash, nav, totalCapital, totalDeployed, totalReturned, totalOutstanding, dealCount }

  // Round 2 (batched): judges, deals, startup reputation + balances, all at once.
  const judgeCfgs = addresses.agenture.judges
  const judgeStatePromises = judgeCfgs.map((j) => fund('getJudge', [j.wallet as Address]))
  const dealPromises = Array.from({ length: dealCount }, (_, i) => fund('getDeal', [BigInt(i)]))
  const repPromises = startups.map((s) =>
    publicClient.readContract({
      address: REP,
      abi: reputationAbi,
      functionName: 'getSummary',
      args: [BigInt(s.agentId), KNOWN_CLIENTS, '', ''],
    }),
  )
  const balPromises = startups.map((s) =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [s.wallet as Address] }),
  )
  // A judge's spendable budget is simply the USDC in its own wallet.
  const judgeBalPromises = judgeCfgs.map((j) =>
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [j.wallet as Address] }),
  )
  // What each deal has actually sold. Only the fund's cut moves onchain, so this is the
  // one place the underlying revenue is recorded.
  const revenuePromises = Array.from({ length: dealCount }, (_, i) =>
    publicClient.readContract({
      address: addresses.agenture.revenueShare as Address,
      abi: revenueShareAbi,
      functionName: 'reportedRevenue',
      args: [BigInt(i)],
    }),
  )

  const [judgeStates, deals, reps, bals, judgeBals, dealRevenues] = await withRetry(() =>
    Promise.all([
      Promise.all(judgeStatePromises),
      Promise.all(dealPromises),
      Promise.all(repPromises),
      Promise.all(balPromises),
      Promise.all(judgeBalPromises),
      Promise.all(revenuePromises),
    ]),
  )

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

  const startupRows: StartupRow[] = startups.map((s, i) => {
    const [count, value] = reps[i] as [bigint, bigint, number]
    return {
      name: s.name,
      wallet: s.wallet,
      agentId: s.agentId,
      pitch: s.pitch,
      reputation: Number(count) > 0 ? { count: Number(count), value: Number(value) } : null,
      balance: bals[i] as bigint,
      // Sum the reported revenue of every deal this agent holds. One agent can be backed
      // by several judges, and each of those deals meters its sales separately.
      revenue: dealRows
        .filter((d) => d.startup.toLowerCase() === s.wallet.toLowerCase())
        .reduce((sum, d) => sum + ((dealRevenues[d.id] as bigint) ?? 0n), 0n),
    }
  })

  return { fund: fundState, judges, deals: dealRows, startups: startupRows }
}
