import { Link } from 'react-router-dom'
import { useOverview } from '@/components/Shell'
import { Card, CardHeader, Pill, Meter, AddressChip, Rationale, DetailLink } from '@/components/ui'
import { PageTitle, LoadingState, Empty } from '@/routes/Dashboard'
import { usdc, bpsToPct } from '@/lib/format'
import { judgeColor } from '@/lib/roster'
import { addresses } from '@/lib/addresses'
import { rounds, type Verdict } from '@/lib/rounds'
import type { JudgeRow, Overview } from '@/lib/data'

// The panel. A judge is only as good as its record, so each card puts the thesis it
// claims next to what its mandate actually did onchain.

type TrackRecord = {
  reviewed: number
  commits: number
  avgConviction: number
  lastRationale: Verdict | null
}

// Everything a judge has said across every recorded round.
function trackRecord(judge: string): TrackRecord {
  const all = rounds.flatMap((r) => r.verdicts).filter((v) => v.judge === judge)
  const reviewed = all.filter((v) => v.outcome !== 'no-mandate')
  const commits = reviewed.filter((v) => v.outcome === 'committed')
  const avg = reviewed.length > 0 ? reviewed.reduce((a, v) => a + v.score, 0) / reviewed.length : 0
  return {
    reviewed: reviewed.length,
    commits: commits.length,
    avgConviction: avg,
    lastRationale: commits[0] ?? reviewed[0] ?? null,
  }
}

export default function Judges() {
  const { data, error } = useOverview()
  if (!data) return <LoadingState note={error ? 'Arc public RPC is busy. Retrying…' : undefined} />

  return (
    <div className="mx-auto max-w-[1340px]">
      <PageTitle
        title="The panel"
        sub="Each judge is an established entrepreneur agent with its own thesis, its own Circle wallet and its own mandate. They never vote together: three judges, three opinions, three signatures."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {data.judges.map((j) => (
          <JudgeCard key={j.wallet} j={j} data={data} />
        ))}
      </div>

      <DivergenceCard />
    </div>
  )
}

function JudgeCard({ j, data }: { j: JudgeRow; data: Overview }) {
  const color = judgeColor(j.name)
  const record = trackRecord(j.name)
  const deals = data.deals.filter((d) => d.judgeName === j.name)
  const utilization = j.committed > 0n ? Number((j.deployed * 100n) / j.committed) : 0
  const profitable = j.roiBps > 0

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between border-b border-line px-5 py-5">
        <div className="flex items-center gap-3.5">
          <span
            className="grid h-12 w-12 place-items-center rounded-lg text-[15px] font-semibold uppercase"
            style={{ background: `${color}1f`, color }}
          >
            {j.name.slice(0, 2)}
          </span>
          <div>
            <Link
              to={`/judges/${j.name.toLowerCase()}`}
              className="text-[19px] font-semibold capitalize leading-tight tracking-tight text-ink transition-colors hover:text-primary"
            >
              {j.name}
            </Link>
            <div className="eyebrow mt-1">{j.label}</div>
          </div>
        </div>
        {j.active ? <Pill tone="gain" dot>Active</Pill> : <Pill tone="neutral">Inactive</Pill>}
      </div>

      <p className="px-5 py-4 text-[13px] leading-relaxed text-muted">{j.thesis}</p>

      <div className="px-5 pb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="eyebrow">Deployed against commitment</span>
          <span className="tnum text-[12px] text-subtle">
            {usdc(j.deployed)} / {usdc(j.committed)}
          </span>
        </div>
        <Meter pct={utilization} tone="primary" />
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
        <Metric label="Deals made" value={String(deals.length)} />
        <Metric label="Realized ROI" value={bpsToPct(j.roiBps)} tone={profitable ? 'gain' : 'muted'} />
        <Metric label="Wallet holds" value={`${usdc(j.budget)} USDC`} />
        <Metric
          label="Avg conviction"
          value={record.reviewed > 0 ? record.avgConviction.toFixed(0) : '—'}
          sub={record.reviewed > 0 ? `${record.commits}/${record.reviewed} backed` : 'no rounds yet'}
        />
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-line px-5 py-3.5">
        <AddressChip addr={j.wallet} />
        <a
          href={`${addresses.explorer}/address/${j.wallet}`}
          target="_blank"
          rel="noreferrer"
          className="tnum text-[11px] text-primary hover:underline"
        >
          Agent #{j.agentId} ↗
        </a>
      </div>

      <DetailLink
        to={`/judges/${j.name.toLowerCase()}`}
        label={`View ${j.name.charAt(0).toUpperCase() + j.name.slice(1)}'s full record`}
      />
    </Card>
  )
}

function Metric({ label, value, sub, tone = 'ink' }: { label: string; value: string; sub?: string; tone?: 'ink' | 'gain' | 'muted' }) {
  const color = tone === 'gain' ? 'text-gain' : tone === 'muted' ? 'text-muted' : 'text-ink'
  return (
    <div className="bg-surface-2 px-5 py-3.5">
      <div className="eyebrow mb-1.5">{label}</div>
      <div className={`tnum text-[16px] font-semibold ${color}`}>{value}</div>
      {sub && <div className="tnum mt-0.5 text-[10px] text-faint">{sub}</div>}
    </div>
  )
}

// The point of three personas is that they disagree. This shows where, using the most
// recent round in which each judge actually spoke.
function DivergenceCard() {
  const latest = rounds.find((r) => r.verdicts.some((v) => v.outcome !== 'no-mandate'))
  if (!latest) return null

  const spoke = latest.verdicts.filter((v) => v.outcome !== 'no-mandate')
  const byStartup = Array.from(new Set(spoke.map((v) => v.startup)))

  return (
    <Card className="mt-6">
      <CardHeader
        title="Where they disagree"
        right={<span className="eyebrow text-faint">Round {latest.id}</span>}
      />
      {byStartup.length === 0 ? (
        <Empty label="No judge has reviewed a pitch yet." />
      ) : (
        <div className="divide-y divide-line">
          {byStartup.map((s) => {
            const verdicts = spoke.filter((v) => v.startup === s)
            const committed = verdicts.filter((v) => v.outcome === 'committed')
            const split = committed.length > 0 && committed.length < verdicts.length
            return (
              <div key={s} className="px-5 py-4">
                <div className="mb-2.5 flex flex-wrap items-center gap-3">
                  <span className="text-[14px] font-medium text-ink">{s}</span>
                  {split ? (
                    <Pill tone="caution">Split decision</Pill>
                  ) : committed.length > 0 ? (
                    <Pill tone="gain">Backed by all</Pill>
                  ) : (
                    <Pill tone="neutral">Passed by all</Pill>
                  )}
                  <span className="tnum text-[11px] text-faint">
                    conviction {Math.min(...verdicts.map((v) => v.score))}–{Math.max(...verdicts.map((v) => v.score))}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                  {verdicts.map((v) => (
                    <div key={v.judge} className="min-w-0">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: judgeColor(v.judge) }} />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{v.judge}</span>
                        <span className={`text-[10px] font-semibold uppercase ${v.outcome === 'committed' ? 'text-gain' : 'text-faint'}`}>
                          {v.outcome === 'committed' ? `commit ${v.allocatedUsdc.toFixed(2)}` : 'pass'}
                        </span>
                      </div>
                      <Rationale>“{v.rationale}”</Rationale>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="border-t border-line px-5 py-3.5 text-[12px] leading-relaxed text-faint">
        Every judge saw identical diligence. The differences below come only from their theses, and each one signed its
        own transaction. Fund cash at the time: {latest.cashBeforeUsdc.toFixed(2)} USDC.
      </p>
    </Card>
  )
}
