import { Link } from 'react-router-dom'
import { useOverview } from '@/components/Shell'
import { Card, Chip, Meter, ReputationRing, AddressChip } from '@/components/ui'
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

  const rated = data.startups.filter((s) => s.reputation)
  const avgRep = rated.length > 0 ? rated.reduce((a, s) => a + s.reputation!.value, 0) / rated.length : 0

  return (
    <div className="mx-auto max-w-[1340px]">
      <PageTitle
        title="Startups"
        sub="Agents pitching for capital. What they claim about themselves sits next to what Arc can prove about them."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <Stat label="On the roster" value={String(data.startups.length)} />
        </Card>
        <Card>
          <Stat label="With a track record" value={`${rated.length} of ${data.startups.length}`} />
        </Card>
        <Card>
          <Stat label="Average reputation" value={rated.length > 0 ? avgRep.toFixed(0) : '—'} accent />
        </Card>
        <Card>
          <Stat label="Capital received" value={`${usdc(data.deals.reduce((a, d) => a + d.amount, 0n))} USDC`} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {data.startups.map((s) => (
          <StartupCard key={s.wallet} s={s} data={data} />
        ))}
      </div>
    </div>
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

function StartupCard({ s, data }: { s: StartupRow; data: Overview }) {
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
              {deals.length > 0 ? <Chip tone="gain">Funded</Chip> : <Chip tone="neutral">Pitching</Chip>}
              {!s.reputation && <Chip tone="caution">Cold start</Chip>}
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
        <div className="flex items-center gap-4">
          <ReputationRing score={s.reputation ? s.reputation.value : null} size={58} label="rep" />
          <div className="min-w-0 flex-1 space-y-2">
            <Row
              label="Ratings"
              value={s.reputation ? `${s.reputation.count} from trusted clients` : 'none yet'}
              muted={!s.reputation}
            />
            <Row label="Wallet holds" value={`${usdc(s.balance)} USDC`} />
            <Row label="Paid to the fund" value={`${usdc(returned)} USDC`} muted={returned === 0n} />
          </div>
        </div>
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
    </Card>
  )
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-faint">{label}</span>
      <span className={`tnum truncate text-right ${muted ? 'text-muted' : 'text-ink'}`}>{value}</span>
    </div>
  )
}
