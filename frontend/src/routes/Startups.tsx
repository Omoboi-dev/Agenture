import { Link } from 'react-router-dom'
import { useOverview } from '@/components/Shell'
import { Card, Chip, Meter, ReputationRing, AddressChip, DetailLink } from '@/components/ui'
import { PageTitle, LoadingState } from '@/routes/Dashboard'
import { usdc, usdcNum } from '@/lib/format'
import { judgeColor } from '@/lib/roster'
import { addresses } from '@/lib/addresses'
import type { Overview, StartupRow } from '@/lib/data'

// The roster. The whole thesis of the fund is that a claim and a record are different
// things, so every card shows the two side by side and never blends them.

export default function Startups() {
  const { data, error } = useOverview()
  if (!data) return <LoadingState note={error ? 'Arc public RPC is busy. Retrying…' : undefined} />

  // Stage comes from the chain, exactly as the agents derive it: a startup that has taken
  // capital is a portfolio company, not deal flow, and does not pitch again.
  const withDeals = (s: StartupRow) =>
    data.deals.filter((d) => d.startup.toLowerCase() === s.wallet.toLowerCase())
  const dealFlow = data.startups.filter((s) => withDeals(s).length === 0)
  const portfolio = data.startups.filter((s) => withDeals(s).length > 0)

  const deployed = data.deals.reduce((a, d) => a + d.amount, 0n)
  const returned = data.deals.reduce((a, d) => a + d.returned, 0n)
  const proven = dealFlow.filter((s) => s.market).length

  return (
    <div className="mx-auto max-w-[1340px]">
      <PageTitle
        title="Startups"
        sub="Agents pitching for capital, and the ones already backed. What they claim about themselves sits next to what Arc can prove."
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <Stat label="Seeking capital" value={String(dealFlow.length)} />
        </Card>
        <Card>
          <Stat label="Arriving proven" value={`${proven} of ${dealFlow.length}`} />
        </Card>
        <Card>
          <Stat label="In portfolio" value={String(portfolio.length)} accent />
        </Card>
        <Card>
          <Stat label="Capital deployed" value={`${usdc(deployed)} USDC`} />
        </Card>
      </div>

      <Section
        title="Seeking funding"
        sub="Never funded here. Heard in the order they registered, three per round."
        count={dealFlow.length}
        empty="Every agent on the roster has been funded. New ones join the queue as they are provisioned."
      >
        {dealFlow.map((s, i) => (
          <StartupCard key={s.wallet} s={s} data={data} queue={i + 1} />
        ))}
      </Section>

      <Section
        title="Already funded"
        sub="Backed and out of the queue, earning and paying their revenue share back."
        count={portfolio.length}
        empty="No capital has been deployed yet."
        right={
          <span className="tnum text-[12px] text-gain">
            {usdc(returned)} USDC returned
          </span>
        }
      >
        {portfolio.map((s) => (
          <StartupCard key={s.wallet} s={s} data={data} />
        ))}
      </Section>
    </div>
  )
}

function Section({
  title,
  sub,
  count,
  empty,
  right,
  children,
}: {
  title: string
  sub: string
  count: number
  empty: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-ink">
            {title} <span className="tnum text-[14px] font-normal text-faint">{count}</span>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">{sub}</p>
        </div>
        {right}
      </div>
      {count === 0 ? (
        <div className="rounded-lg border border-dashed border-line px-5 py-10 text-center font-mono text-[13px] text-faint">
          {empty}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">{children}</div>
      )}
    </section>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow mb-2">{label}</div>
      <div className={`tnum text-[22px] font-semibold leading-none ${accent ? 'text-primary' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

function StartupCard({ s, data, queue }: { s: StartupRow; data: Overview; queue?: number }) {
  const deals = data.deals.filter((d) => d.startup.toLowerCase() === s.wallet.toLowerCase())
  const raised = deals.reduce((a, d) => a + d.amount, 0n)
  const returned = deals.reduce((a, d) => a + d.returned, 0n)
  const backers = Array.from(new Set(deals.map((d) => d.judgeName)))
  const claimed = s.pitch.monthlyRevenueUsdc

  // How much of what it claims per month it has actually paid back to the fund. Small on
  // testnet, but it is the only revenue number here that is not self-reported.
  const provenPct = claimed > 0 ? Math.min(100, (usdcNum(returned) / claimed) * 100) : 0

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between border-b border-line px-5 py-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-surface-4 text-[14px] font-semibold text-primary">
            {s.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <Link
              to={`/startups/${s.name.toLowerCase()}`}
              className="truncate text-[19px] font-semibold leading-tight tracking-tight text-ink transition-colors hover:text-primary"
            >
              {s.name}
            </Link>
            <div className="mt-1 flex items-center gap-2">
              {deals.length > 0 ? (
                <Chip tone="gain">Funded</Chip>
              ) : (
                <Chip tone={queue !== undefined && queue <= 3 ? 'primary' : 'neutral'}>
                  {queue === undefined ? 'Seeking' : queue <= 3 ? `Next round · #${queue}` : `Queue #${queue}`}
                </Chip>
              )}
              {!s.market && <Chip tone="caution">Never sold</Chip>}
            </div>
          </div>
        </div>
      </div>

      <p className="px-5 py-4 text-[13px] leading-relaxed text-muted">{s.pitch.idea}</p>

      {/* Verified half */}
      <div className="mx-5 mb-4 rounded-md border border-line bg-surface-3/60 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow text-primary">Onchain record</span>
          <span className="text-[10px] uppercase tracking-wide text-faint">verified</span>
        </div>
        {/* The ring shows the customer score, not the blend. A judge's rating of a company
            it already backed is an opinion with a position behind it, and averaging the two
            hides the only number nobody here had a reason to inflate. */}
        <div className="flex items-center gap-4">
          <ReputationRing score={s.market ? s.market.value : null} size={58} label="buyers" />
          <div className="min-w-0 flex-1 space-y-2">
            {/* Not "from 4 buyers": it overflows this column and truncates, and the label
                already says these are customers, so the count alone carries it. */}
            <Row
              label="Paying customers"
              value={s.market ? `${s.market.value} from ${s.market.count}` : 'never sold'}
              muted={!s.market}
            />
            <Row
              label="Other investors"
              value={s.investor ? `${s.investor.value} from ${s.investor.count}` : 'none'}
              muted
            />
            <Row label="Wallet holds" value={`${usdc(s.balance)} USDC`} />
            <Row label="Paid to the fund" value={`${usdc(returned)} USDC`} muted={returned === 0n} />
          </div>
        </div>
        <RatingGap s={s} />
      </div>

      {/* Claimed half */}
      <div className="mx-5 mb-4 rounded-md border border-dashed border-line/70 px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="eyebrow">The pitch</span>
          <span className="text-[10px] uppercase tracking-wide text-faint">self-reported</span>
        </div>
        <div className="space-y-2">
          <Row label="Monthly revenue" value={`${claimed.toLocaleString('en-US')} USDC`} muted />
          <Row label="Estimated worth" value={`${s.pitch.estimatedWorthUsdc.toLocaleString('en-US')} USDC`} muted />
          <Row label="Asking" value={`${s.pitch.askUsdc.toLocaleString('en-US')} USDC`} muted />
        </div>
        {claimed > 0 && (
          <div className="mt-3.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="eyebrow">Claim backed by settled revenue</span>
              <span className="tnum text-[11px] text-subtle">{provenPct.toFixed(1)}%</span>
            </div>
            <Meter pct={provenPct} tone={provenPct > 0 ? 'gain' : 'neutral'} />
          </div>
        )}
      </div>

      <div className="mt-auto">
        {deals.length > 0 && (
          <div className="flex items-center gap-2.5 border-t border-line px-5 py-3.5">
            <span className="eyebrow">Backed by</span>
            {backers.map((b) => (
              <span key={b} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: judgeColor(b) }} />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{b}</span>
              </span>
            ))}
            <span className="tnum ml-auto text-[12px] text-primary">{usdc(raised)} USDC</span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-line px-5 py-3.5">
          <AddressChip addr={s.wallet} />
          <a
            href={`${addresses.explorer}/address/${s.wallet}`}
            target="_blank"
            rel="noreferrer"
            className="tnum text-[11px] text-primary hover:underline"
          >
            Agent #{s.agentId} ↗
          </a>
        </div>
      </div>

      <DetailLink to={`/startups/${s.name.toLowerCase()}`} label={`View ${s.name}'s full record`} />
    </Card>
  )
}

// Where the two sources disagree, say so. On this deployment the investor average runs
// above what the buyers report, and the widest gaps sit on agents no customer has ever
// paid, which is exactly the case a reputation system exists to catch.
function RatingGap({ s }: { s: StartupRow }) {
  const gap = s.market && s.investor ? s.investor.value - s.market.value : null
  if (gap !== null && gap >= 12) {
    return (
      <p className="mt-3 text-[11.5px] leading-relaxed text-caution">
        Investors rate it {gap} points above its own paying customers.
      </p>
    )
  }
  if (!s.market && s.investor && s.investor.value >= 70) {
    return (
      <p className="mt-3 text-[11.5px] leading-relaxed text-caution">
        Carries a {s.investor.value} from investors while never having sold to anyone.
      </p>
    )
  }
  return null
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-faint">{label}</span>
      <span className={`tnum truncate text-right ${muted ? 'text-muted' : 'text-ink'}`}>{value}</span>
    </div>
  )
}
