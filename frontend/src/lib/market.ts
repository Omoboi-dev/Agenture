import file from '@shared/market.json'
import roster from '@shared/customers.json'

// The buying side of the marketplace. Payments and ratings are onchain and re-read live;
// what lives only here is why a customer bought what it bought, which is not the kind of
// thing a chain records. Types mirror agents/src/marketlog.ts and shared/customers.json.

export type CustomerMeta = {
  name: string
  role: string
  needs: string[]
  budgetUsdc: number
  weights: { experience: number; reputation: number; price: number }
  explore: number
  wallet: string | null
  agentId: number | null
}

export type Experience = {
  orders: number
  units: number
  spentUsdc: number
  satisfaction: number
  lastRunId: number
}

export type Reason = 'repeat' | 'reputation' | 'trial'

export type Order = {
  customer: string
  provider: string
  sector: string
  units: number
  unitPriceUsdc: number
  amountUsdc: number
  reason: Reason
  paidTx: string | null
  satisfaction: number | null
  rated: number | null
  ratedTx: string | null
  /** Present when the seller actually performed the work and the buyer checked it.
   *  Null means the sector has no implementation yet and the score came from the
   *  seller's hidden quality instead. Mirrors agents/src/marketlog.ts. */
  delivery?: { verified: boolean; jobs: number; note: string } | null
}

export type Settlement = {
  startup: string
  dealId: number | null
  revenueUsdc: number
  cutUsdc: number
  judge: string | null
  note?: string
}

export type MarketRun = {
  id: number
  at: string
  dryRun: boolean
  note: { customer: string; text: string } | null
  orders: Order[]
  settlements: Settlement[]
}

export const customers: CustomerMeta[] = roster.customers as CustomerMeta[]

export const runs: MarketRun[] = ((file as { runs?: MarketRun[] }).runs ?? []).slice().sort((a, b) => b.id - a.id)

/** What each customer has learned about each seller. Private to that customer in the
 *  agents; shown here because a demo that hides its own state proves nothing. */
export const memory: Record<string, Record<string, Experience>> =
  (file as { memory?: Record<string, Record<string, Experience>> }).memory ?? {}

export const latestRun: MarketRun | undefined = runs.find((r) => !r.dryRun)

export const SECTOR_LABEL: Record<string, string> = {
  'market-data': 'Market data',
  'onchain-data': 'Onchain data',
  payments: 'Payments',
  compliance: 'Compliance',
  identity: 'Identity',
  media: 'Media',
  storage: 'Storage',
  logistics: 'Logistics',
  security: 'Security',
}

export const sectorLabel = (s: string) => SECTOR_LABEL[s] ?? s

/** One cool tone per buyer, so a colour means the same customer everywhere. */
const CUSTOMER_COLORS: Record<string, string> = {
  QuantDesk: '#9ec7ff',
  LedgerWorks: '#8fe0c4',
  AtlasOps: '#d9b382',
  StudioLoop: '#c8a4e8',
}
export const customerColor = (name: string) => CUSTOMER_COLORS[name] ?? '#8f909d'

export function ordersBy(customer: string): Order[] {
  return latestRun?.orders.filter((o) => o.customer === customer) ?? []
}

export function ordersFor(provider: string): Order[] {
  return latestRun?.orders.filter((o) => o.provider === provider) ?? []
}

/** Everyone who has ever bought from this seller, across every recorded run. */
export function buyersOf(provider: string): string[] {
  const seen = new Set<string>()
  for (const r of runs) for (const o of r.orders) if (o.provider === provider && o.paidTx) seen.add(o.customer)
  return [...seen]
}

const REASON_LABEL: Record<Reason, string> = {
  repeat: 'Bought before',
  reputation: 'On reputation',
  trial: 'First look',
}
export const reasonLabel = (r: Reason) => REASON_LABEL[r] ?? r
