import { Link, useParams } from 'react-router-dom'
import { useOverview } from '@/components/Shell'
import { Card, CardHeader, Pill, Meter, AddressChip, Rationale } from '@/components/ui'
import { LoadingState, Empty } from '@/routes/Dashboard'
import { usdc, bpsToPct } from '@/lib/format'
import { judgeColor } from '@/lib/roster'
import { addresses } from '@/lib/addresses'
import { verdictHistory } from '@/lib/rounds'
import type { DealRow, JudgeRow } from '@/lib/data'

// One judge, and the case for trusting it. A thesis is cheap; the record underneath is
// what the fund actually has to go on.

export default function JudgeDetail() {
  const { name } = useParams<{ name: string }>()
  const { data, error } = useOverview()
  if (!data) return <LoadingState note={error ? 'Arc public RPC is busy. Retrying…' : undefined} />

  const judge = data.judges.find((j) => j.name.toLowerCase() === (name ?? '').toLowerCase())
  if (!judge) {
    return (
      <div className="mx-auto max-w-[1340px]">
        <Card className="px-6 py-12 text-center">
          <p className="text-[14px] text-muted">No judge called “{name}” sits on this panel.</p>
          <Link to="/judges" className="mt-4 inline-block text-[13px] text-primary hover:underline">
            Back to the panel
          </Link>
        </Card>
      </div>
    )
  }

  const deals = data.deals.filter((d) => d.judgeName === judge.name)
  const history = verdictHistory({ judge: judge.name })
  const reviewed = history.filter((h) => h.verdict.outcome !== 'no-mandate')
  const commits = reviewed.filter((h) => h.verdict.outcome === 'committed')
  const avgConviction = reviewed.length > 0 ? reviewed.reduce((a, h) => a + h.verdict.score, 0) / reviewed.length : 0
  const hitRate = reviewed.length > 0 ? (commits.length / reviewed.length) * 100 : 0

  return (
    <div className="mx-auto max-w-[1340px]">
      <Header judge={judge} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <Stat label="Deployed, all time" value={usdc(judge.deployed)} unit="USDC" />
        </Card>
        <Card>
          <Stat label="Realized ROI" value={bpsToPct(judge.roiBps)} accent={judge.roiBps > 0} />
        </Card>
        <Card>
          <Stat label="Average conviction" value={reviewed.length > 0 ? avgConviction.toFixed(0) : '—'} />
        </Card>
        <Card>
          <Stat
            label="Backs what it hears"
            value={reviewed.length > 0 ? `${hitRate.toFixed(0)}%` : '—'}
            sub={reviewed.length > 0 ? `${commits.length} of ${reviewed.length} pitches` : undefined}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <DecisionsCard history={history} />
        <div className="flex flex-col gap-6">
          <MandateCard judge={judge} />
          <PortfolioCard deals={deals} />
        </div>
      </div>
    </div>
  )
}

function Header({ judge }: { judge: JudgeRow }) {
  const color = judgeColor(judge.name)
  return (
    <div className="mb-6">
      <Link to="/judges" className="eyebrow text-faint transition-colors hover:text-muted">
        ← The panel
      </Link>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <span
          className="grid h-14 w-14 shrink-0 place-items-center rounded-lg text-[17px] font-semibold uppercase"
          style={{ background: `${color}1f`, color }}
        >
          {judge.name.slice(0, 2)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-semibold capitalize tracking-tight text-ink">{judge.name}</h1>
            {judge.active ? <Pill tone="gain" dot>Active</Pill> : <Pill tone="neutral">Inactive</Pill>}
            <span className="eyebrow">{judge.label}</span>
          </div>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">{judge.thesis}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <AddressChip addr={judge.wallet} />
            <a
              href={`${addresses.explorer}/address/${judge.wallet}`}
              target="_blank"
              rel="noreferrer"
              className="tnum text-[11px] text-primary hover:underline"
            >
              Agent #{judge.agentId} ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, unit, sub, accent = false }: { label: string; value: string; unit?: string; sub?: string; accent?: boolean }) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`tnum text-[20px] font-semibold leading-none ${accent ? 'text-gain' : 'text-ink'}`}>{value}</span>
        {unit && <span className="eyebrow">{unit}</span>}
      </div>
      {sub && <div className="tnum mt-1.5 text-[10px] text-faint">{sub}</div>}
    </div>
  )
}

function MandateCard({ judge }: { judge: JudgeRow }) {
  // See Judges.tsx: deployed is a lifetime total and is not bounded by the commitment.
  const utilization = judge.committed > 0n ? Number((judge.called * 100n) / judge.committed) : 0
  const remaining = judge.budget
  return (
    <Card>
      <CardHeader title="Balance sheet" />
      <div className="px-5 py-5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="eyebrow">Commitment drawn</span>
          <span className="tnum text-[12px] text-primary">{utilization.toFixed(1)}%</span>
        </div>
        <Meter pct={utilization} tone="primary" />
        <div className="mt-5 space-y-2.5 text-[12px]">
          <Row label="Committed by the fund" value={`${usdc(judge.committed)} USDC`} />
          <Row label="Drawn down" value={`${usdc(judge.called)} USDC`} />
          <Row label="Still callable" value={`${usdc(judge.committed - judge.called)} USDC`} accent={judge.committed > judge.called} />
          <Row label="Deployed" value={`${usdc(judge.deployed)} USDC`} />
          <Row label="In its wallet now" value={`${usdc(remaining)} USDC`} accent={remaining > 0n} />
          <Row label="Returned to fund" value={`${usdc(judge.returned)} USDC`} />
        </div>
        <p className="mt-4 border-t border-line pt-3.5 text-[12px] leading-relaxed text-faint">
The fund commits capital; the judge draws it down itself with a capital call when it decides it needs
          the money. Nobody hands it anything. Its returns raise the commitment, so backing winners earns the right
          to call for more.
        </p>
      </div>
    </Card>
  )
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-faint">{label}</span>
      <span className={`tnum ${accent ? 'text-primary' : 'text-subtle'}`}>{value}</span>
    </div>
  )
}

function PortfolioCard({ deals }: { deals: DealRow[] }) {
  return (
    <Card>
      <CardHeader title="Portfolio" right={<span className="eyebrow text-faint">{deals.length} positions</span>} />
      {deals.length === 0 ? (
        <Empty label="No positions yet." />
      ) : (
        <div className="divide-y divide-line">
          {[...deals].reverse().map((d) => (
            <Link
              key={d.id}
              to={`/startups/${d.startupName.toLowerCase()}`}
              className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-surface-3/60"
            >
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-ink">{d.startupName}</div>
                <div className="tnum mt-0.5 text-[10px] text-faint">
                  deal #{d.id} · {d.revenueShareBps} bps
                </div>
              </div>
              <div className="text-right">
                <div className="tnum text-[13px] text-ink">{usdc(d.amount)}</div>
                <div className={`tnum mt-0.5 text-[10px] ${d.returned > 0n ? 'text-gain' : 'text-faint'}`}>
                  +{usdc(d.returned)} back
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  )
}

function DecisionsCard({ history }: { history: ReturnType<typeof verdictHistory> }) {
  return (
    <Card>
      <CardHeader title="Decision history" right={<span className="eyebrow text-faint">{history.length} entries</span>} />
      {history.length === 0 ? (
        <Empty label="This judge has not sat a round yet." />
      ) : (
        <div className="divide-y divide-line">
          {history.map(({ round, verdict: v }) => (
            <div key={`${round.id}-${v.startup}`} className="px-5 py-4">
              <div className="mb-2.5 flex flex-wrap items-center gap-3">
                <Link
                  to={`/startups/${v.startup.toLowerCase()}`}
                  className="text-[14px] font-medium text-ink transition-colors hover:text-primary"
                >
                  {v.startup}
                </Link>
                {v.outcome === 'committed' ? (
                  <Pill tone="gain">Commit {v.allocatedUsdc.toFixed(2)} USDC</Pill>
                ) : v.outcome === 'no-budget' ? (
                  <Pill tone="caution">Wanted in, no budget</Pill>
                ) : v.outcome === 'no-mandate' ? (
                  <Pill tone="neutral">Abstained</Pill>
                ) : (
                  <Pill tone="neutral">Pass</Pill>
                )}
                <span className="tnum text-[11px] text-faint">
                  round {round.id}
                  {v.outcome !== 'no-mandate' && ` · conviction ${v.score}`}
                  {v.outcome === 'committed' && ` · ${v.revenueShareBps} bps`}
                </span>
              </div>
              {v.outcome === 'no-mandate' ? (
                <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-[12px] text-faint">
                  Did not review: {v.rationale}.
                </p>
              ) : (
                <Rationale>“{v.rationale}”</Rationale>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
