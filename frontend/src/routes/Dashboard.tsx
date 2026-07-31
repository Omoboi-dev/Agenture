import { useOverview } from '@/components/Shell'
import { Card, CardHeader, StatTile, Pill, Meter, Eyebrow, Dot } from '@/components/ui'
import { AreaChart, Donut, type DonutSeg } from '@/components/charts'
import { usdc, usdcNum, bpsToPct, signed } from '@/lib/format'
import type { DealRow, Overview } from '@/lib/data'
import { judgeColor } from '@/lib/roster'

const initials = (name: string) => (name.match(/[A-Z]/g) ?? [name[0]]).slice(0, 2).join('')

export default function Dashboard() {
  const { data, error } = useOverview()
  if (!data) return <LoadingState note={error ? 'Arc public RPC is busy. Retrying…' : undefined} />

  const { fund } = data
  const roiBps = fund.totalDeployed > 0n ? Number((fund.totalReturned * 10000n) / fund.totalDeployed) : 0
  const navDeltaPct =
    fund.totalCapital > 0n ? (usdcNum(fund.nav) / usdcNum(fund.totalCapital) - 1) * 100 : 0

  return (
    <div className="mx-auto max-w-[1340px]">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <Eyebrow>Dashboard / Overview</Eyebrow>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-ink">Fund</h1>
        </div>
      </div>

      {/* Stat rail */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Card>
          <StatTile label="Net Asset Value" value={usdc(fund.nav)} unit="USDC" delta={signed(navDeltaPct, 1) + '%'} deltaTone={navDeltaPct >= 0 ? 'primary' : 'loss'} />
        </Card>
        <Card>
          <StatTile label="Available Liquidity" value={usdc(fund.cash)} unit="USDC" />
        </Card>
        <Card>
          <StatTile label="Capital Deployed" value={usdc(fund.totalDeployed)} unit="USDC" />
        </Card>
        <Card>
          <StatTile label="Total Returned" value={usdc(fund.totalReturned)} unit="USDC" />
        </Card>
        <Card>
          <div className="flex items-center justify-between px-5 py-4">
            <StatTile label="Realized ROI" value={bpsToPct(roiBps)} accent />
            <Sparkbars />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Left */}
        <div className="flex min-w-0 flex-col gap-6">
          <ValuationCard data={data} />
          <PortfolioCard data={data} />
        </div>

        {/* Right */}
        <div className="flex flex-col gap-6">
          <AllocationCard data={data} />
          <LedgerCard data={data} />
          <IntegrityCard data={data} />
        </div>
      </div>
    </div>
  )
}

function ValuationCard({ data }: { data: Overview }) {
  // Cumulative capital allocated across deals: real amounts, in deal order.
  const ordered = [...data.deals].sort((a, b) => a.id - b.id)
  let acc = 0
  const series = [0, ...ordered.map((d) => (acc += usdcNum(d.amount)))]
  const peak = Math.max(...series, 0)
  const last = ordered.length - 1
  const labels = ['Deal 0', '', '', '', last >= 0 ? `Deal ${last}` : 'Now']

  return (
    <Card>
      <div className="flex items-start justify-between px-5 pt-5">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight text-ink">Portfolio Growth</h2>
          <p className="mt-0.5 text-[13px] text-muted">Cumulative capital allocated across deals</p>
        </div>
        <div className="text-right">
          <Eyebrow>Peak allocated</Eyebrow>
          <div className="tnum mt-1 text-[15px] text-primary">{usdc(BigInt(Math.round(peak * 1e6)))} USDC</div>
        </div>
      </div>
      <div className="px-5 pb-5 pt-4">
        <AreaChart values={series} labels={labels} height={220} />
      </div>
    </Card>
  )
}

function PortfolioCard({ data }: { data: Overview }) {
  const { deals } = data
  return (
    <Card>
      <CardHeader title="Active Portfolio" right={<span className="eyebrow text-faint">{deals.length} positions</span>} />
      {deals.length === 0 ? (
        <Empty label="No deals yet. Run a round to deploy capital." />
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="eyebrow border-b border-line text-left">
              <th className="px-5 py-3 font-semibold">Entity</th>
              <th className="px-3 py-3 font-semibold">Lead Judge</th>
              <th className="px-3 py-3 text-right font-semibold">Capital</th>
              <th className="px-3 py-3 text-right font-semibold">Equity</th>
              <th className="px-5 py-3 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {[...deals].reverse().map((d) => (
              <PortfolioRow key={d.id} d={d} color={judgeColor(d.judgeName)} />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function PortfolioRow({ d, color }: { d: DealRow; color: string }) {
  return (
    <tr className="border-b border-line/60 last:border-0 hover:bg-surface-3/60">
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="tnum grid h-7 w-7 place-items-center rounded-md border border-line bg-surface-4 text-[10px] font-semibold text-subtle">
            {initials(d.startupName)}
          </span>
          <span className="font-medium text-ink">{d.startupName}</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{d.judgeName}</span>
        </span>
      </td>
      <td className="px-3 py-3 text-right">
        <span className="tnum text-ink">{usdc(d.amount)}</span> <span className="text-[10px] text-faint">USDC</span>
      </td>
      <td className="px-3 py-3 text-right">
        <span className="tnum text-subtle">{d.revenueShareBps}</span> <span className="text-[10px] text-faint">BPS</span>
      </td>
      <td className="px-5 py-3 text-right">
        {d.status === 0 ? <Pill tone="gain" dot>Allocated</Pill> : <Pill tone="neutral">Closed</Pill>}
      </td>
    </tr>
  )
}

function AllocationCard({ data }: { data: Overview }) {
  const active = data.judges.filter((j) => j.deployed > 0n)
  const total = active.reduce((a, j) => a + usdcNum(j.deployed), 0) || 1
  const segments: DonutSeg[] = active.map((j) => ({
    label: j.name,
    value: usdcNum(j.deployed),
    color: judgeColor(j.name),
  }))
  return (
    <Card>
      <CardHeader title="Allocation by Judge" />
      <div className="flex items-center gap-6 px-5 py-5">
        <Donut segments={segments} centerTop={String(active.length)} centerBottom="Active" />
        <div className="flex-1 space-y-2.5">
          {active.length === 0 && <span className="text-[13px] text-faint">No capital deployed.</span>}
          {active.map((j) => (
            <div key={j.name} className="flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: judgeColor(j.name) }} />
                <span className="capitalize text-subtle">{j.name}</span>
              </span>
              <span className="tnum text-muted">{Math.round((usdcNum(j.deployed) / total) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

type LedgerItem = { id: number; kind: 'alloc' | 'settle'; text: string; amount: string }

function LedgerCard({ data }: { data: Overview }) {
  const items: LedgerItem[] = []
  for (const d of data.deals) {
    items.push({ id: d.id * 2, kind: 'alloc', text: `${d.judgeName} committed to ${d.startupName}`, amount: `${usdc(d.amount)} USDC` })
    if (d.returned > 0n)
      items.push({ id: d.id * 2 + 1, kind: 'settle', text: `${d.startupName} settled revenue share`, amount: `+${usdc(d.returned)} USDC` })
  }
  const recent = items.sort((a, b) => b.id - a.id).slice(0, 5)

  return (
    <Card>
      <CardHeader
        title="Live Protocol Ledger"
        right={
          <span className="flex items-center gap-1.5">
            <Dot tone="gain" pulse />
            <span className="eyebrow text-gain">Stream</span>
          </span>
        }
      />
      <div className="divide-y divide-line">
        {recent.map((it) => (
          <div key={it.id} className="flex items-start gap-3 px-5 py-3.5">
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ${it.kind === 'settle' ? 'bg-gain/12 text-gain' : 'bg-primary/12 text-primary'}`}>
              {it.kind === 'settle' ? <IconReturn /> : <IconAlloc />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-ink">{it.text}</div>
              <div className="tnum mt-0.5 text-[11px] text-faint">Onchain · Arc</div>
            </div>
            <span className={`tnum shrink-0 text-[12px] ${it.kind === 'settle' ? 'text-gain' : 'text-subtle'}`}>{it.amount}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function IntegrityCard({ data }: { data: Overview }) {
  const { fund } = data
  const deployedPct = fund.totalCapital > 0n ? Number((fund.totalOutstanding * 100n) / fund.totalCapital) : 0
  const returnPct = fund.totalDeployed > 0n ? Number((fund.totalReturned * 100n) / fund.totalDeployed) : 0
  return (
    <Card>
      <CardHeader title="Fund Health" />
      <div className="space-y-4 px-5 py-5">
        <MeterRow label="Capital at work" value={`${deployedPct.toFixed(1)}%`} pct={deployedPct} tone="primary" />
        <MeterRow label="Return rate" value={`${returnPct.toFixed(1)}%`} pct={returnPct} tone="gain" />
      </div>
    </Card>
  )
}

function MeterRow({ label, value, pct, tone }: { label: string; value: string; pct: number; tone: 'primary' | 'gain' }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <span className={`tnum text-[12px] ${tone === 'gain' ? 'text-gain' : 'text-primary'}`}>{value}</span>
      </div>
      <Meter pct={pct} tone={tone} />
    </div>
  )
}

function Sparkbars() {
  return (
    <div className="flex items-end gap-0.5">
      {[6, 10, 8, 14, 18].map((h, i) => (
        <span key={i} className="w-1 rounded-sm bg-primary/70" style={{ height: h }} />
      ))}
    </div>
  )
}

function IconAlloc() {
  return (<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6.5 2.5v8M3 6l3.5-3.5L10 6" /></svg>)
}
function IconReturn() {
  return (<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6.5 10.5v-8M3 7l3.5 3.5L10 7" /></svg>)
}

export function PageTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[28px] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1 max-w-2xl text-[14px] text-muted">{sub}</p>
    </div>
  )
}

export function LoadingState({ note }: { note?: string }) {
  return (
    <div className="grid h-64 place-items-center gap-2 text-center font-mono text-[13px] text-faint">
      <span>Reading Arc…</span>
      {note && <span className="text-caution">{note}</span>}
    </div>
  )
}
export function Empty({ label }: { label: string }) {
  return <div className="px-5 py-10 text-center font-mono text-[13px] text-faint">{label}</div>
}
