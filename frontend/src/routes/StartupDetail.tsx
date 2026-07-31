import { Link, useParams } from 'react-router-dom'
import { useOverview } from '@/components/Shell'
import { Card, CardHeader, Pill, Chip, Meter, ReputationRing, AddressChip, Rationale } from '@/components/ui'
import { LoadingState, Empty } from '@/routes/Dashboard'
import { usdc, usdcNum, bpsToPct } from '@/lib/format'
import { judgeColor } from '@/lib/roster'
import { addresses } from '@/lib/addresses'
import { verdictHistory, latestDossier } from '@/lib/rounds'
import type { DealRow, StartupRow } from '@/lib/data'

// One startup, in full. The page is deliberately split down the middle: what it says
// about itself on the left, what Arc can prove on the right, never merged into a single
// flattering number.

export default function StartupDetail() {
  const { name } = useParams<{ name: string }>()
  const { data, error } = useOverview()
  if (!data) return <LoadingState note={error ? 'Arc public RPC is busy. Retrying…' : undefined} />

  const startup = data.startups.find((s) => s.name.toLowerCase() === (name ?? '').toLowerCase())
  if (!startup) {
    return (
      <div className="mx-auto max-w-[1340px]">
        <Card className="px-6 py-12 text-center">
          <p className="text-[14px] text-muted">No startup called “{name}” is on the roster.</p>
          <Link to="/startups" className="mt-4 inline-block text-[13px] text-primary hover:underline">
            Back to the roster
          </Link>
        </Card>
      </div>
    )
  }

  const deals = data.deals.filter((d) => d.startup.toLowerCase() === startup.wallet.toLowerCase())
  const raised = deals.reduce((a, d) => a + d.amount, 0n)
  const returned = deals.reduce((a, d) => a + d.returned, 0n)
  const history = verdictHistory({ startup: startup.name }).filter((h) => h.verdict.outcome !== 'no-mandate')

  return (
    <div className="mx-auto max-w-[1340px]">
      <Header startup={startup} funded={deals.length > 0} />

      <div className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ClaimedCard startup={startup} />
        <VerifiedCard startup={startup} returned={returned} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <AuditCard history={history} />
        <LedgerCard deals={deals} raised={raised} returned={returned} />
      </div>
    </div>
  )
}

function Header({ startup, funded }: { startup: StartupRow; funded: boolean }) {
  return (
    <div className="mb-6">
      <Link to="/startups" className="eyebrow text-faint transition-colors hover:text-muted">
        ← Startups
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-line bg-surface-4 text-[16px] font-semibold text-primary">
            {startup.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[28px] font-semibold tracking-tight text-ink">{startup.name}</h1>
              {funded ? <Pill tone="gain" dot>Funded</Pill> : <Pill tone="neutral">Pitching</Pill>}
              {!startup.reputation && <Chip tone="caution">Cold start</Chip>}
            </div>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted">{startup.pitch.idea}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip tone="primary">ERC-8004 identity</Chip>
              <AddressChip addr={startup.wallet} />
              <a
                href={`${addresses.explorer}/address/${startup.wallet}`}
                target="_blank"
                rel="noreferrer"
                className="tnum text-[11px] text-primary hover:underline"
              >
                Agent #{startup.agentId} ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClaimedCard({ startup }: { startup: StartupRow }) {
  return (
    <Card>
      <CardHeader title="Self-reported pitch" right={<Pill tone="caution">Unverified</Pill>} />
      <div className="px-5 py-5">
        <div className="eyebrow mb-2">Monthly recurring revenue</div>
        <div className="flex items-baseline gap-2">
          <span className="tnum text-[34px] font-semibold leading-none text-subtle">
            {startup.pitch.monthlyRevenueUsdc.toLocaleString('en-US')}
          </span>
          <span className="eyebrow">USDC</span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-5 border-t border-line pt-5">
          <div>
            <div className="eyebrow mb-2">Valuation estimate</div>
            <div className="tnum text-[18px] font-semibold text-subtle">
              {startup.pitch.estimatedWorthUsdc.toLocaleString('en-US')} <span className="eyebrow">USDC</span>
            </div>
          </div>
          <div>
            <div className="eyebrow mb-2">Capital requirement</div>
            <div className="tnum text-[18px] font-semibold text-subtle">
              {startup.pitch.askUsdc.toLocaleString('en-US')} <span className="eyebrow">USDC</span>
            </div>
          </div>
        </div>

        <p className="mt-6 border-t border-line pt-4 text-[12px] leading-relaxed text-faint">
          Every number in this panel was supplied by the startup itself and is not checked by anything. The judges are
          explicitly instructed to weigh it below the record on the right.
        </p>
      </div>
    </Card>
  )
}

function VerifiedCard({ startup, returned }: { startup: StartupRow; returned: bigint }) {
  const rep = startup.reputation
  const snapshot = latestDossier(startup.name)
  const claimed = startup.pitch.monthlyRevenueUsdc
  const provenPct = claimed > 0 ? Math.min(100, (usdcNum(returned) / claimed) * 100) : 0

  return (
    <Card>
      <CardHeader title="Onchain verified record" right={<Pill tone="primary">Verified</Pill>} />
      <div className="px-5 py-5">
        <div className="flex items-center gap-5">
          <ReputationRing score={rep ? rep.value : null} size={82} label="index" />
          <div className="min-w-0">
            <div className="eyebrow mb-1.5">Reputation score</div>
            {rep ? (
              <>
                <div className="tnum text-[22px] font-semibold text-ink">
                  {rep.value}
                  <span className="text-[13px] text-faint">/100</span>
                </div>
                <div className="mt-1 text-[12px] text-primary">
                  averaged over {rep.count} rating{rep.count === 1 ? '' : 's'} from trusted clients
                </div>
              </>
            ) : (
              <>
                <div className="text-[16px] font-semibold text-caution">No record</div>
                <div className="mt-1 text-[12px] text-faint">Never rated. The judges price this as real risk.</div>
              </>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-5 border-t border-line pt-5">
          <div>
            <div className="eyebrow mb-2">Live wallet liquidity</div>
            <div className="tnum text-[18px] font-semibold text-ink">
              {usdc(startup.balance)} <span className="eyebrow">USDC</span>
            </div>
          </div>
          <div>
            <div className="eyebrow mb-2">Settled to the fund</div>
            <div className={`tnum text-[18px] font-semibold ${returned > 0n ? 'text-gain' : 'text-faint'}`}>
              {usdc(returned)} <span className="eyebrow">USDC</span>
            </div>
          </div>
        </div>

        {claimed > 0 && (
          <div className="mt-5 border-t border-line pt-5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="eyebrow">Claimed revenue backed by settlements</span>
              <span className="tnum text-[12px] text-subtle">{provenPct.toFixed(1)}%</span>
            </div>
            <Meter pct={provenPct} tone={provenPct > 0 ? 'gain' : 'neutral'} />
          </div>
        )}

        {snapshot && (
          <p className="mt-5 border-t border-line pt-4 text-[12px] leading-relaxed text-faint">
            Read from the ERC-8004 Reputation Registry and the USDC contract on Arc. At its last diligence the wallet
            held {snapshot.usdcBalance.toFixed(2)} USDC.
          </p>
        )}
      </div>
    </Card>
  )
}

function AuditCard({ history }: { history: ReturnType<typeof verdictHistory> }) {
  return (
    <Card>
      <CardHeader
        title="What the panel said"
        right={<span className="eyebrow text-faint">{history.length} verdicts</span>}
      />
      {history.length === 0 ? (
        <Empty label="No judge has reviewed this startup yet." />
      ) : (
        <div className="divide-y divide-line">
          {history.map(({ round, verdict: v }) => (
            <div key={`${round.id}-${v.judge}`} className="px-5 py-4">
              <div className="mb-2.5 flex flex-wrap items-center gap-3">
                <Link
                  to={`/judges/${v.judge}`}
                  className="flex items-center gap-2 transition-opacity hover:opacity-80"
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: judgeColor(v.judge) }} />
                  <span className="text-[14px] font-semibold capitalize text-ink">{v.judge}</span>
                </Link>
                {v.outcome === 'committed' ? (
                  <Pill tone="gain">Commit {v.allocatedUsdc.toFixed(2)} USDC</Pill>
                ) : v.outcome === 'no-budget' ? (
                  <Pill tone="caution">Wanted in, no budget</Pill>
                ) : (
                  <Pill tone="neutral">Pass</Pill>
                )}
                <span className="tnum text-[11px] text-faint">
                  round {round.id} · conviction {v.score}
                  {v.outcome === 'committed' && ` · ${v.revenueShareBps} bps`}
                </span>
              </div>
              <Rationale>“{v.rationale}”</Rationale>
            </div>
          ))}
        </div>
      )}
      <p className="border-t border-line px-5 py-3.5 text-[12px] leading-relaxed text-faint">
        These are the judges' rationales at the moment of decision, recorded in the round archive. The numeric ERC-8004
        score above is written separately, after a deal settles.
      </p>
    </Card>
  )
}

function LedgerCard({
  deals,
  raised,
  returned,
}: {
  deals: DealRow[]
  raised: bigint
  returned: bigint
}) {
  const yieldBps = raised > 0n ? Number((returned * 10000n) / raised) : 0
  return (
    <Card>
      <CardHeader title="Capital inflow ledger" />
      {deals.length === 0 ? (
        <Empty label="No capital committed yet." />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="eyebrow border-b border-line text-left">
              <th className="px-5 py-3 font-semibold">Judge</th>
              <th className="px-3 py-3 text-right font-semibold">Commitment</th>
              <th className="px-5 py-3 text-right font-semibold">Share</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((d) => (
              <tr key={d.id} className="border-b border-line/60 last:border-0">
                <td className="px-5 py-3">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: judgeColor(d.judgeName) }} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{d.judgeName}</span>
                  </span>
                </td>
                <td className="tnum px-3 py-3 text-right text-ink">{usdc(d.amount)}</td>
                <td className="tnum px-5 py-3 text-right text-muted">{d.revenueShareBps} bps</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
        <div className="bg-surface-2 px-5 py-4">
          <div className="eyebrow mb-1.5">Total raised</div>
          <div className="tnum text-[16px] font-semibold text-ink">{usdc(raised)} USDC</div>
        </div>
        <div className="bg-surface-2 px-5 py-4">
          <div className="eyebrow mb-1.5">Paid back</div>
          <div className={`tnum text-[16px] font-semibold ${returned > 0n ? 'text-gain' : 'text-faint'}`}>
            {bpsToPct(yieldBps)}
          </div>
        </div>
      </div>
    </Card>
  )
}
