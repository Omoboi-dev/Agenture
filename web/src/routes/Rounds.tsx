import { useState } from 'react'
import { Card, CardHeader, StatTile, Pill, Eyebrow } from '@/components/ui'
import { PageTitle, Empty } from '@/routes/Dashboard'
import { judgeColor } from '@/lib/roster'
import { addresses } from '@/lib/addresses'
import { rounds, roundAllocated, type RoundLog, type Verdict } from '@/lib/rounds'

// The archive. Each round expands into the decision matrix that produced it: every judge
// against every pitch, so where the personas disagree is visible in one grid.

export default function Rounds() {
  const [open, setOpen] = useState<number | null>(rounds[0]?.id ?? null)

  const settled = rounds.filter((r) => !r.dryRun)
  const pitches = rounds.reduce((a, r) => a + r.dossiers.length, 0)
  const deployed = settled.reduce((a, r) => a + roundAllocated(r), 0)
  const deals = settled.reduce((a, r) => a + r.verdicts.filter((v) => v.outcome === 'committed').length, 0)

  return (
    <div className="mx-auto max-w-[1340px]">
      <PageTitle title="Rounds" sub="The protocol archive. Every closing round, its pitches, verdicts and deals." />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <StatTile label="Rounds recorded" value={rounds.length} />
        </Card>
        <Card>
          <StatTile label="Pitches heard" value={pitches} />
        </Card>
        <Card>
          <StatTile label="Capital deployed" value={deployed.toFixed(2)} unit="USDC" accent />
        </Card>
        <Card>
          <StatTile label="Deals struck" value={deals} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Round history" right={<span className="eyebrow text-faint">newest first</span>} />
        {rounds.length === 0 ? (
          <Empty label="No rounds recorded yet. Run the orchestrator to open one." />
        ) : (
          <div className="divide-y divide-line">
            {rounds.map((r) => (
              <RoundRow key={r.id} round={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function RoundRow({ round, open, onToggle }: { round: RoundLog; open: boolean; onToggle: () => void }) {
  const when = new Date(round.endedAt)
  const committed = round.verdicts.filter((v) => v.outcome === 'committed')
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-3/60"
      >
        <span className={`text-faint transition-transform ${open ? 'rotate-90' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 2.5 8 6l-3.5 3.5" />
          </svg>
        </span>
        <span className="w-24 shrink-0 text-[15px] font-semibold text-ink">Round {round.id}</span>
        <span className="tnum w-40 shrink-0 text-[12px] text-muted">
          {when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
          {when.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
        </span>
        <span className="w-28 shrink-0">
          {round.dryRun ? <Pill tone="caution">Dry run</Pill> : <Pill tone="gain" dot>Settled</Pill>}
        </span>
        <span className="hidden flex-1 gap-8 text-[12px] text-muted md:flex">
          <span>
            <span className="tnum text-subtle">{round.dossiers.length}</span> pitches
          </span>
          <span>
            <span className="tnum text-subtle">{committed.length}</span> deals
          </span>
        </span>
        <span className="tnum ml-auto shrink-0 text-[13px] text-primary">{roundAllocated(round).toFixed(2)} USDC</span>
      </button>

      {open && <Matrix round={round} />}
    </div>
  )
}

function Matrix({ round }: { round: RoundLog }) {
  const judges = Array.from(new Set(round.verdicts.map((v) => v.judge)))
  const cell = (judge: string, startup: string) => round.verdicts.find((v) => v.judge === judge && v.startup === startup)

  return (
    <div className="border-t border-line bg-surface/40 px-5 py-5">
      <div className="mb-3 flex items-center justify-between">
        <Eyebrow>Decision matrix</Eyebrow>
        <span className="tnum text-[11px] text-faint">
          fund cash {round.cashBeforeUsdc.toFixed(2)} → {round.cashAfterUsdc.toFixed(2)} USDC
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="w-28" />
              {round.dossiers.map((d) => (
                <th key={d.name} className="px-2 pb-2 text-left">
                  <div className="text-[13px] font-medium text-subtle">{d.name}</div>
                  <div className="tnum text-[10px] font-normal text-faint">
                    {d.reputation ? `rep ${d.reputation.value} · ${d.reputation.count} ratings` : 'cold start'}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {judges.map((j) => (
              <tr key={j}>
                <td className="pr-2 align-top">
                  <span className="flex items-center gap-2 pt-3">
                    <span className="h-2 w-2 rounded-full" style={{ background: judgeColor(j) }} />
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-subtle">{j}</span>
                  </span>
                </td>
                {round.dossiers.map((d) => (
                  <td key={d.name} className="align-top">
                    <MatrixCell v={cell(j, d.name)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MatrixCell({ v }: { v: Verdict | undefined }) {
  if (!v) return <div className="rounded-md border border-dashed border-line px-3 py-3 text-[11px] text-faint">—</div>

  if (v.outcome === 'committed') {
    return (
      <div className="rounded-md border border-gain/25 bg-gain/10 px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gain">Commit</div>
        <div className="tnum mt-1 text-[14px] text-ink">
          {v.allocatedUsdc.toFixed(2)} <span className="text-[10px] text-faint">USDC</span>
        </div>
        <div className="tnum mt-0.5 text-[10px] text-faint">
          {v.revenueShareBps} bps · conviction {v.score}
        </div>
        {v.dealId !== null && v.txHash && (
          <a
            href={`${addresses.explorer}/tx/${v.txHash}`}
            target="_blank"
            rel="noreferrer"
            className="tnum mt-1.5 inline-block text-[10px] text-primary hover:underline"
          >
            deal #{v.dealId} ↗
          </a>
        )}
      </div>
    )
  }

  if (v.outcome === 'no-mandate') {
    return (
      <div className="rounded-md border border-dashed border-line px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Abstain</div>
        <div className="mt-1 text-[11px] leading-snug text-faint">{v.rationale}</div>
      </div>
    )
  }

  const wanted = v.outcome === 'no-budget'
  return (
    <div className="rounded-md border border-line bg-surface-3/60 px-3 py-2.5" title={v.rationale}>
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${wanted ? 'text-caution' : 'text-muted'}`}>
        {wanted ? 'Wanted in' : 'Pass'}
      </div>
      <div className="tnum mt-1 text-[10px] text-faint">conviction {v.score}</div>
      <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-faint">{v.rationale}</p>
    </div>
  )
}
