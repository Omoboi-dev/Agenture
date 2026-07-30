import { useEffect, useMemo, useState } from 'react'
import { useOverview } from '@/components/Shell'
import { Card, CardHeader, Pill, Chip, Eyebrow, Rationale, ReputationRing, AddressChip, Dot } from '@/components/ui'
import { LoadingState } from '@/routes/Dashboard'
import { usdcNum } from '@/lib/format'
import { judgePersonas, judgeColor } from '@/lib/roster'
import { addresses } from '@/lib/addresses'
import { latestRound, dossierFor, verdictsFor, roundAllocated, type Dossier, type Verdict, type RoundLog } from '@/lib/rounds'

// The Arena is the fund deliberating. The left column is one startup's case: what it
// claims, and beside it what Arc actually says about it. The right column is the
// committee, each judge deciding alone with its own mandate.

export default function Arena() {
  const { data, error } = useOverview()
  const round = latestRound
  const [selected, setSelected] = useState(0)

  if (!round) return <NoRound />
  if (!data) return <LoadingState note={error ? 'Arc public RPC is busy. Retrying…' : undefined} />

  const cohort = round.dossiers
  const active = cohort[Math.min(selected, cohort.length - 1)]
  const verdicts = verdictsFor(round, active.name)

  return (
    <div className="mx-auto max-w-[1340px] pb-24">
      <ArenaHeader round={round} />

      <div className="mb-5 flex flex-wrap gap-2">
        {cohort.map((d, i) => (
          <CohortTab
            key={d.name}
            dossier={d}
            verdicts={verdictsFor(round, d.name)}
            active={i === selected}
            onClick={() => setSelected(i)}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <PitchCard dossier={active} verdicts={verdicts} />
          <DiligenceCard dossier={active} />
          <FeedCard round={round} startup={active.name} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Eyebrow>Investment committee</Eyebrow>
            <span className="eyebrow text-faint">
              {verdicts.filter((v) => v.outcome !== 'no-mandate').length} of {verdicts.length} voted
            </span>
          </div>
          {verdicts.length === 0 && (
            <Card className="grid h-32 place-items-center px-5 text-center font-mono text-[12px] text-faint">
              No judge reviewed this pitch in round {round.id}.
            </Card>
          )}
          {verdicts.map((v) => (
            <CommitteeCard key={v.judge} v={v} />
          ))}
        </div>
      </div>

      <AllocationBar round={round} cash={usdcNum(data.fund.cash)} />
    </div>
  )
}

function ArenaHeader({ round }: { round: RoundLog }) {
  const when = new Date(round.endedAt)
  return (
    <div className="mb-5">
      <Eyebrow>Arena / Round {round.id}</Eyebrow>
      <div className="mt-1 flex flex-wrap items-center gap-4">
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">Investment Arena</h1>
        {round.dryRun ? <Pill tone="caution">Dry run</Pill> : <Pill tone="gain" dot pulse>Round settled</Pill>}
        <span className="text-[13px] text-faint">
          Closed{' '}
          <span className="tnum text-muted">
            {when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
            {when.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </span>
      </div>
      <p className="mt-2 max-w-2xl text-[14px] text-muted">
        Every judge hears every pitch, pulls the startup's real ERC-8004 record off Arc, and decides alone. No human
        vote and no consensus step: capital moves the moment a judge signs.
      </p>
    </div>
  )
}

function CohortTab({
  dossier,
  verdicts,
  active,
  onClick,
}: {
  dossier: Dossier
  verdicts: Verdict[]
  active: boolean
  onClick: () => void
}) {
  const committed = verdicts.filter((v) => v.outcome === 'committed')
  const raised = committed.reduce((a, v) => a + v.allocatedUsdc, 0)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-4 py-3 text-left transition-colors ${
        active ? 'border-primary/40 bg-surface-3' : 'border-line bg-surface-2 hover:border-line-bright'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`text-[14px] font-medium ${active ? 'text-ink' : 'text-subtle'}`}>{dossier.name}</span>
        {committed.length > 0 ? <Chip tone="gain">{committed.length} committed</Chip> : <Chip tone="neutral">No allocation</Chip>}
      </div>
      <div className="tnum mt-1 text-[11px] text-faint">
        {raised > 0 ? `${raised.toFixed(2)} USDC raised` : `asked ${dossier.pitch.askUsdc.toFixed(2)} USDC`}
      </div>
    </button>
  )
}

function PitchCard({ dossier, verdicts }: { dossier: Dossier; verdicts: Verdict[] }) {
  const raised = verdicts.filter((v) => v.outcome === 'committed').reduce((a, v) => a + v.allocatedUsdc, 0)
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
        <div className="flex min-w-0 gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-line bg-surface-4 text-[14px] font-semibold text-primary">
            {dossier.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold tracking-tight text-ink">{dossier.name}</h2>
            <p className="mt-1 max-w-xl text-[14px] leading-relaxed text-muted">{dossier.pitch.idea}</p>
          </div>
        </div>
        <div className="text-right">
          <Eyebrow>Raised this round</Eyebrow>
          <div className="tnum mt-1 text-[18px] text-primary">{raised.toFixed(2)} USDC</div>
        </div>
      </div>

      <div className="px-5 pb-5 pt-5">
        <div className="mb-2.5 flex items-center gap-2">
          <Eyebrow>The pitch</Eyebrow>
          <span className="text-[11px] text-faint">self-reported, unverified</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Claim label="Monthly revenue" value={dossier.pitch.monthlyRevenueUsdc} />
          <Claim label="Capital request" value={dossier.pitch.askUsdc} />
          <Claim label="Implied valuation" value={dossier.pitch.estimatedWorthUsdc} />
        </div>
      </div>
    </Card>
  )
}

function Claim({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-dashed border-line/70 bg-surface-3/50 px-4 py-3.5">
      <div className="eyebrow mb-2">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-[20px] font-semibold text-subtle">{value.toLocaleString('en-US')}</span>
        <span className="eyebrow">USDC</span>
      </div>
    </div>
  )
}

function DiligenceCard({ dossier }: { dossier: Dossier }) {
  const rep = dossier.reputation
  return (
    <Card>
      <CardHeader
        title="Autonomous due diligence"
        right={
          <span className="flex items-center gap-1.5">
            <Dot tone="primary" />
            <span className="eyebrow text-primary">Onchain verified</span>
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2">
        <div className="flex items-center gap-4 rounded-md border border-line bg-surface-3/60 px-4 py-4">
          <ReputationRing score={rep ? rep.value : null} label="score" />
          <div className="min-w-0">
            <div className="eyebrow mb-1">Reputation (ERC-8004)</div>
            {rep ? (
              <>
                <div className="text-[14px] text-ink">
                  {rep.count} rating{rep.count === 1 ? '' : 's'} from trusted clients
                </div>
                <div className="tnum mt-1 text-[11px] text-faint">Agent #{dossier.agentId}</div>
              </>
            ) : (
              <>
                <div className="text-[14px] text-caution">Cold start, nothing on record</div>
                <div className="tnum mt-1 text-[11px] text-faint">
                  {dossier.agentId ? `Agent #${dossier.agentId}` : 'No identity registered'}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="rounded-md border border-line bg-surface-3/60 px-4 py-4">
          <div className="eyebrow mb-2">Wallet liquidity at diligence</div>
          <div className="flex items-baseline gap-1.5">
            <span className="tnum text-[22px] font-semibold text-ink">{dossier.usdcBalance.toFixed(2)}</span>
            <span className="eyebrow">USDC</span>
          </div>
          <div className="mt-3">
            <AddressChip addr={dossier.wallet} />
          </div>
        </div>
      </div>
      <p className="border-t border-line px-5 py-3.5 text-[12px] leading-relaxed text-faint">
        Read straight from the ERC-8004 Reputation Registry and the USDC contract on Arc when the round opened. Judges
        are instructed to trust this over anything the pitch claims.
      </p>
    </Card>
  )
}

function CommitteeCard({ v }: { v: Verdict }) {
  const persona = judgePersonas[v.judge]
  const committed = v.outcome === 'committed'
  const color = judgeColor(v.judge)
  return (
    <Card elevated={committed}>
      <div className="flex items-start justify-between px-4 pt-4">
        <div className="flex items-center gap-3">
          <span
            className="grid h-9 w-9 place-items-center rounded-md text-[12px] font-semibold uppercase"
            style={{ background: `${color}1f`, color }}
          >
            {v.judge.slice(0, 2)}
          </span>
          <div>
            <div className="text-[15px] font-semibold capitalize leading-tight text-ink">{v.judge}</div>
            <div className="eyebrow mt-0.5">{persona?.label ?? 'Judge'}</div>
          </div>
        </div>
        {committed ? (
          <Pill tone="gain">Commit</Pill>
        ) : v.outcome === 'no-mandate' ? (
          <Pill tone="caution">Abstain</Pill>
        ) : (
          <Pill tone="neutral">Pass</Pill>
        )}
      </div>

      <div className="px-4 py-3.5">
        {v.outcome === 'no-mandate' ? (
          <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-[13px] leading-relaxed text-faint">
            Did not review this pitch: {v.rationale}, so it had no capital to put behind an opinion.
          </p>
        ) : (
          <Rationale>“{v.rationale || 'No rationale returned.'}”</Rationale>
        )}
      </div>

      <div className="flex items-end justify-between border-t border-line px-4 py-3.5">
        <div>
          <div className="eyebrow mb-1">{committed ? 'Commitment' : 'No allocation'}</div>
          <div className={`tnum text-[17px] font-semibold ${committed ? 'text-ink' : 'text-faint'}`}>
            {v.allocatedUsdc.toFixed(2)} <span className="eyebrow">USDC</span>
          </div>
        </div>
        <div className="text-right">
          <div className="eyebrow mb-1">{v.outcome === 'no-mandate' ? 'No conviction' : `Conviction ${v.score}`}</div>
          <div className={`tnum text-[12px] ${committed ? 'text-primary' : 'text-faint'}`}>
            {committed ? `${v.revenueShareBps} bps` : '0 bps'}
          </div>
        </div>
      </div>

      {v.outcome === 'no-budget' && (
        <div className="border-t border-line px-4 py-2.5 text-[11px] text-caution">
          Wanted in, but its mandate was already spent on higher-conviction deals.
        </div>
      )}
      {committed && v.dealId !== null && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <span className="eyebrow text-faint">Deal #{v.dealId}</span>
          {v.txHash && (
            <a
              href={`${addresses.explorer}/tx/${v.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="tnum text-[11px] text-primary hover:underline"
            >
              View on Arcscan ↗
            </a>
          )}
        </div>
      )}
    </Card>
  )
}

type FeedLine = { tag: string; text: string; tone: 'sys' | 'dd' | 'judge' | 'chain' }

// The feed replays what actually happened in the round, in order, from the recorded log.
function buildFeed(round: RoundLog, startup: string): FeedLine[] {
  const d = dossierFor(round, startup)
  const lines: FeedLine[] = [
    {
      tag: 'SYSTEM',
      tone: 'sys',
      text: `Round ${round.id} opened · ${round.dossiers.length} pitches · ${round.cashBeforeUsdc.toFixed(2)} USDC available`,
    },
  ]
  if (d) {
    lines.push({ tag: 'DILIGENCE', tone: 'dd', text: `${d.name} · resolving ERC-8004 identity ${d.agentId ?? 'none'}` })
    lines.push({
      tag: 'DILIGENCE',
      tone: 'dd',
      text: d.reputation
        ? `${d.name} · ${d.reputation.count} ratings averaging ${d.reputation.value} from trusted clients`
        : `${d.name} · no reputation on record, treating as cold start`,
    })
    lines.push({ tag: 'DILIGENCE', tone: 'dd', text: `${d.name} · wallet holds ${d.usdcBalance.toFixed(2)} USDC onchain` })
  }
  for (const v of verdictsFor(round, startup)) {
    lines.push({
      tag: v.judge.toUpperCase(),
      tone: 'judge',
      text:
        v.outcome === 'committed'
          ? `COMMIT ${v.allocatedUsdc.toFixed(2)} USDC @ ${v.revenueShareBps} bps · conviction ${v.score}`
          : v.outcome === 'no-budget'
            ? `WANTED IN at conviction ${v.score} · budget exhausted mid-round`
            : v.outcome === 'no-mandate'
              ? `ABSTAIN · ${v.rationale}`
              : `PASS · conviction ${v.score}`,
    })
    if (v.dealId !== null) {
      lines.push({
        tag: 'ARC',
        tone: 'chain',
        text: `Deal #${v.dealId} confirmed · ${v.txHash ? `${v.txHash.slice(0, 18)}…` : 'tx pending'}`,
      })
    }
  }
  lines.push({
    tag: 'SYSTEM',
    tone: 'sys',
    text: `Round ${round.id} closed · ${roundAllocated(round).toFixed(2)} USDC deployed across the cohort`,
  })
  return lines
}

const feedTone: Record<FeedLine['tone'], string> = {
  sys: 'text-muted',
  dd: 'text-subtle',
  judge: 'text-primary',
  chain: 'text-gain',
}

function FeedCard({ round, startup }: { round: RoundLog; startup: string }) {
  const lines = useMemo(() => buildFeed(round, startup), [round, startup])
  const [shown, setShown] = useState(0)

  // Replay the log line by line when the pitch changes: the same recorded data, revealed
  // at reading speed so a deliberation is legible instead of arriving as a wall of text.
  useEffect(() => {
    setShown(0)
    const t = setInterval(() => {
      setShown((n) => {
        if (n >= lines.length) {
          clearInterval(t)
          return n
        }
        return n + 1
      })
    }, 260)
    return () => clearInterval(t)
  }, [lines])

  const t0 = new Date(round.startedAt).getTime()
  const stamp = (i: number) =>
    new Date(t0 + i * 3400).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

  return (
    <Card>
      <CardHeader
        title="Analysis feed"
        right={
          <span className="flex items-center gap-1.5">
            <Dot tone={shown < lines.length ? 'gain' : 'neutral'} pulse={shown < lines.length} />
            <span className="eyebrow text-faint">{shown < lines.length ? 'Replaying' : `Round ${round.id} log`}</span>
          </span>
        }
      />
      <div className="space-y-1.5 px-5 py-4 font-mono text-[12px] leading-relaxed">
        {lines.slice(0, shown).map((l, i) => (
          <div key={i} className="flex gap-3">
            <span className="shrink-0 text-faint">{stamp(i)}</span>
            <span className="shrink-0 text-faint">[{l.tag}]</span>
            <span className={feedTone[l.tone]}>{l.text}</span>
          </div>
        ))}
        {shown < lines.length && <span className="inline-block h-3.5 w-1.5 animate-pulse bg-primary/70 align-middle" />}
      </div>
    </Card>
  )
}

function AllocationBar({ round, cash }: { round: RoundLog; cash: number }) {
  const allocated = roundAllocated(round)
  const judges = Array.from(new Set(round.verdicts.map((v) => v.judge)))
  return (
    <div className="glass fixed bottom-0 left-[260px] right-0 z-10 border-t border-line px-8 py-4">
      <div className="mx-auto flex max-w-[1340px] flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-8">
          <div>
            <div className="eyebrow mb-1">Deployed this round</div>
            <div className="tnum text-[18px] font-semibold text-ink">
              {allocated.toFixed(2)} <span className="eyebrow">USDC</span>
            </div>
          </div>
          <div>
            <div className="eyebrow mb-1">Available liquidity</div>
            <div className="tnum text-[18px] font-semibold text-ink">
              {cash.toFixed(2)} <span className="eyebrow">USDC</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex -space-x-2">
            {judges.map((j) => (
              <span
                key={j}
                title={j}
                className="grid h-8 w-8 place-items-center rounded-full border-2 border-surface text-[11px] font-semibold uppercase"
                style={{ background: `${judgeColor(j)}26`, color: judgeColor(j) }}
              >
                {j.slice(0, 1)}
              </span>
            ))}
          </div>
          <span className="rounded-md border border-line bg-surface-3 px-4 py-2 text-[13px] text-muted">
            {round.dryRun ? 'Preview only, no capital moved' : 'Committee vote final, settled onchain'}
          </span>
        </div>
      </div>
    </div>
  )
}

function NoRound() {
  return (
    <div className="mx-auto max-w-[1340px]">
      <Eyebrow>Arena</Eyebrow>
      <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-ink">Investment Arena</h1>
      <Card className="mt-6 px-6 py-12 text-center">
        <p className="text-[14px] text-muted">No round has been recorded yet.</p>
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-faint">
          Run a round from the orchestrator to fill the arena. Every deliberation is written to{' '}
          <span className="tnum text-subtle">shared/rounds.json</span>, which this page reads alongside live Arc state.
        </p>
        <code className="mt-5 inline-block rounded-md border border-line bg-surface-3 px-4 py-2 font-mono text-[12px] text-primary">
          cd agents &amp;&amp; bun run round
        </code>
      </Card>
    </div>
  )
}
