import { Link } from 'react-router-dom'
import { useOverview } from '@/components/Shell'
import { Card, CardHeader, Chip, Meter, Dot } from '@/components/ui'
import { PageTitle, LoadingState, Empty } from '@/routes/Dashboard'
import { usdc, usdcNum } from '@/lib/format'
import {
  latestRun,
  memory,
  ordersBy,
  buyersOf,
  customerColor,
  sectorLabel,
  reasonLabel,
  type Order,
} from '@/lib/market'
import type { Overview, StartupRow, CustomerRow } from '@/lib/data'

// Both sides of the market on one page, and the buyers come first.
//
// Every other page looks outward from the fund: what it committed, what it deployed, what
// came back. Here the fund is a spectator. Four customer agents hold their own wallets
// and decide for themselves what they need; a seller earns because one of them chose it,
// and the fund's returns are whatever is left after those choices.
//
// Revenue is read from RevenueShare.reportedRevenue deal by deal, which is the only
// onchain record of what an agent sold as opposed to the cut the fund took from it. Who
// bought and why comes from shared/market.json, because a chain does not record reasons.

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
  const buying = data.customers.filter((c) => c.wallet)

  return (
    <div className="mx-auto max-w-[1340px]">
      <PageTitle
        title="Marketplace"
        sub="Independent customer agents buy what they need from the funded roster. Each holds its own wallet, picks its own suppliers, and rates them afterwards. The fund earns a share of whatever they decide to spend."
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

      <BuyersStrip customers={buying} />

      {/* items-start, or the order book stretches to whatever height the two cards beside
          it happen to add up to and trails a column of empty surface. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
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
              <span className="eyebrow mb-1.5 block">Funded, but no customer yet</span>
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
          <LastRunCard />
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

// The buyers. They lead the page because they are the reason any of the numbers below
// move: nothing in this market is allocated, it is chosen.
function BuyersStrip({ customers }: { customers: CustomerRow[] }) {
  if (customers.length === 0) {
    return (
      <Card className="mb-6">
        <div className="px-5 py-6 text-[13px] text-muted">
          No customer agents have wallets yet. Until they do, nothing on the roster has anyone to sell to.
        </div>
      </Card>
    )
  }

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[16px] font-semibold tracking-tight text-ink">The buyers</h2>
        <span className="eyebrow text-faint">{customers.length} independent wallets</span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {customers.map((c) => (
          <BuyerCard key={c.name} c={c} />
        ))}
      </div>
    </div>
  )
}

const WEIGHT_LABEL = { experience: 'Past experience', reputation: 'Reputation', price: 'Price' } as const

/** The buyer's priorities in the order it actually weighs them. */
function priorities(w: CustomerRow['weights']): string[] {
  return (Object.keys(WEIGHT_LABEL) as (keyof typeof WEIGHT_LABEL)[])
    .sort((a, b) => w[b] - w[a])
    .map((k) => WEIGHT_LABEL[k])
}

function BuyerCard({ c }: { c: CustomerRow }) {
  const orders = ordersBy(c.name)
  const spent = orders.reduce((a, o) => a + (o.paidTx ? o.amountUsdc : 0), 0)
  const book = Object.entries(memory[c.name] ?? {}).sort((a, b) => b[1].satisfaction - a[1].satisfaction)
  const color = customerColor(c.name)

  return (
    <Card>
      <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 0 3px ${color}22` }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-ink">{c.name}</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{c.role}</p>
        </div>
      </div>

      <div className="flex items-baseline justify-between px-4 py-3">
        <div>
          <div className="eyebrow mb-1">Wallet</div>
          <div className="tnum text-[15px] font-semibold text-ink">{usdc(c.balance)}</div>
        </div>
        <div className="text-right">
          <div className="eyebrow mb-1">Spent last run</div>
          <div className="tnum text-[15px] font-semibold text-primary">{spent.toFixed(2)}</div>
        </div>
      </div>

      {/* What it weighs, not what it is allowed to buy. Every buyer browses the whole
          roster; they differ in what they care about and in who they have dealt with. */}
      <div className="px-4 pb-3">
        <div className="eyebrow mb-1.5">How it picks</div>
        <div className="flex flex-wrap gap-1.5">
          {priorities(c.weights).map((p, i) => (
            <span
              key={p}
              className={`rounded border px-1.5 py-0.5 text-[10.5px] ${
                i === 0
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-line bg-surface-3 text-subtle'
              }`}
            >
              {p}
            </span>
          ))}
        </div>
      </div>

      {book.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <div className="eyebrow mb-2">Who it trusts</div>
          <div className="space-y-1.5">
            {book.slice(0, 3).map(([provider, e]) => (
              <div key={provider} className="flex items-center gap-2 text-[11.5px]">
                <Link
                  to={`/startups/${provider.toLowerCase()}`}
                  className="min-w-0 flex-1 truncate text-subtle transition-colors hover:text-primary"
                >
                  {provider}
                </Link>
                <span className="tnum shrink-0 text-faint">{e.orders}x</span>
                <span
                  className={`tnum shrink-0 ${e.satisfaction >= 0.7 ? 'text-gain' : e.satisfaction >= 0.45 ? 'text-subtle' : 'text-loss'}`}
                >
                  {Math.round(e.satisfaction * 100)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// What happened in the most recent market run, in the buyer's own words where there are
// any. The sentence is written by the model after the fact and changes nothing: the
// trading below it is what settled onchain.
function LastRunCard() {
  if (!latestRun) {
    return (
      <Card>
        <CardHeader title="Last market run" />
        <Empty label="No market run recorded yet." />
      </Card>
    )
  }

  const paid = latestRun.orders.filter((o) => o.paidTx)
  const when = new Date(latestRun.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <Card>
      <CardHeader
        title="Last market run"
        right={<span className="eyebrow text-faint">{when}</span>}
      />
      {latestRun.note && (
        <div className="border-b border-line px-5 py-4">
          <p className="text-[12.5px] italic leading-relaxed text-subtle">“{latestRun.note.text}”</p>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: customerColor(latestRun.note.customer) }} />
            <span className="eyebrow">{latestRun.note.customer}</span>
          </div>
        </div>
      )}
      {paid.length === 0 ? (
        <Empty label="Nothing was bought." />
      ) : (
        <div className="divide-y divide-line">
          {paid.map((o, i) => (
            <OrderRow key={`${o.customer}-${o.provider}-${i}`} o={o} />
          ))}
        </div>
      )}
    </Card>
  )
}

function OrderRow({ o }: { o: Order }) {
  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: customerColor(o.customer) }} />
        <span className="truncate text-[12.5px] text-subtle">{o.customer}</span>
        <span className="shrink-0 text-faint">→</span>
        <Link
          to={`/startups/${o.provider.toLowerCase()}`}
          className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink transition-colors hover:text-primary"
        >
          {o.provider}
        </Link>
        <span className="tnum shrink-0 text-[12.5px] text-ink">{o.amountUsdc.toFixed(2)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between pl-3.5">
        <span className="text-[11px] text-faint">
          {o.units} x {sectorLabel(o.sector)} · {reasonLabel(o.reason)}
        </span>
        {o.rated !== null && (
          <span className="flex items-center gap-1.5">
            {o.delivery?.verified && (
              <span
                title={`Checked by the buyer over ${o.delivery.jobs} jobs: ${o.delivery.note}`}
                className="rounded border border-gain/40 bg-gain/10 px-1 py-px text-[9.5px] font-semibold uppercase tracking-wide text-gain"
              >
                Verified
              </span>
            )}
            <span className={`tnum text-[11px] ${o.rated >= 70 ? 'text-gain' : o.rated >= 45 ? 'text-muted' : 'text-loss'}`}>
              rated {o.rated}
            </span>
          </span>
        )}
      </div>
      {/* The buyer's own reason for the score. The whole point of doing the work for real
          is that a rating stops being a number you have to take on trust. */}
      {o.delivery?.verified && (
        <p className="mt-1.5 pl-3.5 text-[10.5px] leading-relaxed text-faint">{o.delivery.note}</p>
      )}
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
  const buyers = buyersOf(s.name)

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
              {/* The buyers' score, not the blend. This is the marketplace: what the
                  people who paid thought is the only rating that belongs on it. */}
              {s.market ? (
                <Chip tone={s.market.value >= 70 ? 'gain' : s.market.value >= 50 ? 'neutral' : 'caution'}>
                  Buyers rate {s.market.value}
                </Chip>
              ) : (
                <Chip tone="caution">Unrated by buyers</Chip>
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
      <div className="mt-3 flex items-center gap-3 pl-8">
        <div className="min-w-0 flex-1">
          <Meter pct={share} tone="primary" />
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            {buyers.length === 0 ? (
              <span className="text-[10.5px] text-faint">no repeat buyer</span>
            ) : (
              buyers.map((b) => (
                <span
                  key={b}
                  title={`${b} buys from ${s.name}`}
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: customerColor(b) }}
                />
              ))
            )}
          </div>
          <Link
            to={`/startups/${s.name.toLowerCase()}`}
            className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10.5px] text-muted transition-colors hover:border-primary/40 hover:text-primary"
          >
            Details →
          </Link>
        </div>
      </div>
    </div>
  )
}

const RAILS = [
  { k: 'Choice', v: 'Each buyer sees the whole roster and scores every seller it can afford, on its own past satisfaction, the public ERC-8004 score, and price' },
  { k: 'Payment', v: 'x402 over EIP-3009. The buyer signs off-chain and the operator submits, so it never needs gas to buy' },
  { k: 'Settlement', v: 'RevenueShare.settle, called by the seller. Revenue splits across every deal backing it' },
  { k: 'Rating', v: 'ERC-8004 feedback, written by the buyer that paid. No judge rates its own portfolio' },
]

function RailsCard() {
  return (
    <Card>
      <CardHeader
        title="How a sale works"
        right={
          <span className="flex items-center gap-1.5">
            <Dot tone="primary" />
            <span className="eyebrow text-faint">x402</span>
          </span>
        }
      />
      <div className="divide-y divide-line">
        {RAILS.map((r) => (
          <div key={r.k} className="px-5 py-3">
            <div className="eyebrow mb-1">{r.k}</div>
            <div className="text-[12px] leading-relaxed text-subtle">{r.v}</div>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-5 py-3.5 text-[12px] leading-relaxed text-faint">
        What is simulated is the delivery itself: a buyer's satisfaction is drawn from how good the seller actually is,
        because there is no real service behind these agents. Everything downstream of that opinion is real. The buyer
        chooses, pays, and rates on its own wallet.
      </p>
    </Card>
  )
}
