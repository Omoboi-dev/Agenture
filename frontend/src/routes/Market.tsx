import { Link } from 'react-router-dom'
import { useOverview } from '@/components/Shell'
import { Card, CardHeader, Pill, Chip, Meter, AddressChip, Dot } from '@/components/ui'
import { PageTitle, LoadingState, Empty } from '@/routes/Dashboard'
import { usdc, usdcNum } from '@/lib/format'
import { addresses } from '@/lib/addresses'
import type { Overview, StartupRow } from '@/lib/data'

// The selling side. Every other page looks at the fund: what it committed, what it
// deployed, what came back. This one looks at the agents doing the work, ranked by what
// they have actually sold, because that is the number the whole fund is a bet on.
//
// Revenue here is read from RevenueShare.reportedRevenue, deal by deal. It is the only
// onchain record of what an agent sold, as opposed to the cut the fund took from it.

export default function Market() {
  const { data, error } = useOverview()
  if (!data) return <LoadingState note={error ? 'Arc public RPC is busy. Retrying…' : undefined} />

  const trading = data.startups
    .filter((s) => s.revenue > 0n)
    .sort((a, b) => (b.revenue > a.revenue ? 1 : b.revenue < a.revenue ? -1 : 0))
  const idle = data.startups.filter((s) => s.revenue === 0n && hasDeal(s, data))

  const volume = data.startups.reduce((a, s) => a + s.revenue, 0n)
  const toFund = data.deals.reduce((a, d) => a + d.returned, 0n)
  const topRevenue = trading[0]?.revenue ?? 1n

  return (
    <div className="mx-auto max-w-[1340px]">
      <PageTitle
        title="Marketplace"
        sub="What the funded agents are selling, and to whom. Every sale is an x402 payment settled on Arc; the fund's cut is skimmed from it automatically."
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <Stat label="Volume sold" value={usdc(volume)} unit="USDC" accent />
        </Card>
        <Card>
          <Stat label="Skimmed to the fund" value={usdc(toFund)} unit="USDC" tone="gain" />
        </Card>
        <Card>
          <Stat label="Agents trading" value={`${trading.length} of ${trading.length + idle.length}`} />
        </Card>
        <Card>
          <Stat
            label="Effective take"
            value={volume > 0n ? `${((usdcNum(toFund) / usdcNum(volume)) * 100).toFixed(1)}%` : '—'}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader
            title="Order book"
            right={<span className="eyebrow text-faint">by revenue sold</span>}
          />
          {trading.length === 0 ? (
            <Empty label="Nothing has sold yet. Run a cycle to put the agents to work." />
          ) : (
            <div className="divide-y divide-line">
              {trading.map((s, i) => (
                <Listing key={s.wallet} s={s} rank={i + 1} data={data} topRevenue={topRevenue} />
              ))}
            </div>
          )}
          {idle.length > 0 && (
            <div className="border-t border-line px-5 py-3.5">
              <span className="eyebrow mb-1.5 block">Funded but not yet trading</span>
              <div className="flex flex-wrap gap-2">
                {idle.map((s) => (
                  <Link
                    key={s.wallet}
                    to={`/startups/${s.name.toLowerCase()}`}
                    className="rounded-md border border-dashed border-line px-2.5 py-1 text-[12px] text-faint transition-colors hover:border-line-bright hover:text-muted"
                  >
                    {s.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <BuyerCard />
          <RailsCard />
        </div>
      </div>
    </div>
  )
}

function hasDeal(s: StartupRow, data: Overview) {
  return data.deals.some((d) => d.startup.toLowerCase() === s.wallet.toLowerCase())
}

function Stat({
  label,
  value,
  unit,
  accent = false,
  tone,
}: {
  label: string
  value: string
  unit?: string
  accent?: boolean
  tone?: 'gain'
}) {
  const color = tone === 'gain' ? 'text-gain' : accent ? 'text-primary' : 'text-ink'
  return (
    <div className="px-5 py-4">
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`tnum text-[22px] font-semibold leading-none ${color}`}>{value}</span>
        {unit && <span className="eyebrow">{unit}</span>}
      </div>
    </div>
  )
}

function Listing({
  s,
  rank,
  data,
  topRevenue,
}: {
  s: StartupRow
  rank: number
  data: Overview
  topRevenue: bigint
}) {
  const deals = data.deals.filter((d) => d.startup.toLowerCase() === s.wallet.toLowerCase())
  const cut = deals.reduce((a, d) => a + d.returned, 0n)
  const share = Number((s.revenue * 100n) / (topRevenue > 0n ? topRevenue : 1n))

  return (
    <div className="px-5 py-4">
      {/* Not flex-wrap: with wrapping, the amount jumps between right-aligned and
          below-left depending on how long the description happens to be. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="tnum mt-0.5 w-5 shrink-0 text-[12px] text-faint">{rank}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/startups/${s.name.toLowerCase()}`}
                className="text-[15px] font-semibold text-ink transition-colors hover:text-primary"
              >
                {s.name}
              </Link>
              {s.reputation ? (
                <Chip tone={s.reputation.value >= 70 ? 'gain' : s.reputation.value >= 50 ? 'neutral' : 'caution'}>
                  Rated {s.reputation.value}
                </Chip>
              ) : (
                <Chip tone="caution">Unrated</Chip>
              )}
            </div>
            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted">{s.pitch.idea}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="tnum text-[16px] font-semibold text-ink">
            {usdc(s.revenue)} <span className="eyebrow">USDC</span>
          </div>
          <div className="tnum mt-0.5 text-[11px] text-gain">{usdc(cut)} to the fund</div>
        </div>
      </div>
      <div className="mt-3 pl-8">
        <Meter pct={share} tone="primary" />
      </div>
    </div>
  )
}

function BuyerCard() {
  const customer = addresses.agenture.customer
  return (
    <Card>
      <CardHeader
        title="The buyer"
        right={
          <span className="flex items-center gap-1.5">
            <Dot tone="primary" />
            <span className="eyebrow text-faint">x402</span>
          </span>
        }
      />
      <div className="px-5 py-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14px] font-medium capitalize text-ink">{customer.name}</span>
          <Pill tone="neutral">Agent</Pill>
        </div>
        <p className="text-[12px] leading-relaxed text-muted">
          A single agent wallet buys from every service here. It signs an EIP-3009 authorization off-chain and the
          operator submits it as the x402 facilitator, so the buyer never needs gas and never sends a transaction
          itself.
        </p>
        <div className="mt-4">
          <AddressChip addr={customer.wallet} />
        </div>
      </div>
      <p className="border-t border-line px-5 py-3.5 text-[12px] leading-relaxed text-faint">
        One buyer stands in for a market of paying agents, and how much it spends on each service is modelled from how
        good that service is rather than observed from real demand. The payment, the revenue share and the rating that
        follows are all real and settle onchain.
      </p>
    </Card>
  )
}

const RAILS = [
  { k: 'Payment', v: 'x402 over EIP-3009, gasless for the buyer' },
  { k: 'Settlement', v: 'RevenueShare.settle, called by the seller' },
  { k: 'Metering', v: 'reportedRevenue per deal, read live from Arc' },
  { k: 'Rating', v: 'ERC-8004 feedback, written by the deal’s judge' },
]

function RailsCard() {
  return (
    <Card>
      <CardHeader title="How a sale settles" />
      <div className="divide-y divide-line">
        {RAILS.map((r) => (
          <div key={r.k} className="px-5 py-3">
            <div className="eyebrow mb-1">{r.k}</div>
            <div className="text-[12px] leading-relaxed text-subtle">{r.v}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
