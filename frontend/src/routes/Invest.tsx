import { useState } from 'react'
import { useOverview } from '@/components/Shell'
import { Card, CardHeader, Pill, Meter, AddressChip, Dot } from '@/components/ui'
import { PageTitle, LoadingState } from '@/routes/Dashboard'
import { usdc, usdcNum, signed } from '@/lib/format'
import { addresses } from '@/lib/addresses'
import type { Overview } from '@/lib/data'

// The LP edge: the one place a human touches the fund. Deposits are permissionless
// onchain today, but the contract has no share accounting and no withdraw path, so this
// page says exactly that instead of miming a flow that does not exist.

export default function Invest() {
  const { data, error } = useOverview()
  if (!data) return <LoadingState note={error ? 'Arc public RPC is busy. Retrying…' : undefined} />

  return (
    <div className="mx-auto max-w-[1340px]">
      <PageTitle
        title="Invest"
        sub="Supply USDC and the panel puts it to work. Humans deposit at the edge; every allocation decision after that is made and signed by an agent."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-6">
          <CapitalCard data={data} />
          <FlowCard data={data} />
        </div>
        <div className="flex flex-col gap-6">
          <DepositCard data={data} />
          <TermsCard />
        </div>
      </div>
    </div>
  )
}

function CapitalCard({ data }: { data: Overview }) {
  const { fund } = data
  const growth = fund.totalCapital > 0n ? (usdcNum(fund.nav) / usdcNum(fund.totalCapital) - 1) * 100 : 0
  const deployedPct = fund.totalCapital > 0n ? Number((fund.totalOutstanding * 100n) / fund.totalCapital) : 0

  return (
    <Card>
      <CardHeader
        title="Fund position"
        right={
          <span className="flex items-center gap-1.5">
            <Dot tone="gain" pulse />
            <span className="eyebrow text-faint">Live on Arc</span>
          </span>
        }
      />
      <div className="grid grid-cols-2 gap-px bg-line md:grid-cols-4">
        <Cell label="Net asset value" value={usdc(fund.nav)} unit="USDC" accent />
        <Cell label="Capital supplied" value={usdc(fund.totalCapital)} unit="USDC" />
        <Cell label="Idle liquidity" value={usdc(fund.cash)} unit="USDC" />
        <Cell
          label="Since inception"
          value={`${signed(growth, 2)}%`}
          tone={growth >= 0 ? 'gain' : 'loss'}
        />
      </div>
      <div className="px-5 py-5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="eyebrow">Capital at work</span>
          <span className="tnum text-[12px] text-primary">{deployedPct.toFixed(1)}%</span>
        </div>
        <Meter pct={deployedPct} tone="primary" />
        <p className="mt-3 text-[12px] leading-relaxed text-faint">
          Idle liquidity is not lost yield, it is dry powder. A judge can only sign an allocation the fund can actually
          cover, so the panel stops deploying when cash runs out even when conviction is high.
        </p>
      </div>
    </Card>
  )
}

function Cell({
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
  tone?: 'gain' | 'loss'
}) {
  const color = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : accent ? 'text-primary' : 'text-ink'
  return (
    <div className="bg-surface-2 px-5 py-4">
      <div className="eyebrow mb-2 leading-4">{label}</div>
      <div className="flex items-baseline gap-1.5">
        <span className={`tnum text-[20px] font-semibold leading-none ${color}`}>{value}</span>
        {unit && <span className="eyebrow">{unit}</span>}
      </div>
    </div>
  )
}

function FlowCard({ data }: { data: Overview }) {
  const { fund } = data
  const steps = [
    { label: 'Supplied by LPs', value: fund.totalCapital, note: 'depositCapital() on the Fund' },
    { label: 'Allocated by judges', value: fund.totalDeployed, note: 'invest() signed by a judge wallet' },
    { label: 'Outstanding in deals', value: fund.totalOutstanding, note: 'live positions at cost' },
    { label: 'Returned as revenue share', value: fund.totalReturned, note: 'settle() paid by startups' },
  ]
  const max = steps.reduce((a, s) => (s.value > a ? s.value : a), 1n)

  return (
    <Card>
      <CardHeader title="Where the capital goes" />
      <div className="space-y-5 px-5 py-5">
        {steps.map((s) => (
          <div key={s.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-subtle">{s.label}</span>
              <span className="tnum text-[13px] text-ink">
                {usdc(s.value)} <span className="text-[10px] text-faint">USDC</span>
              </span>
            </div>
            <Meter pct={Number((s.value * 100n) / max)} tone="primary" />
            <div className="tnum mt-1.5 text-[11px] text-faint">{s.note}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function DepositCard({ data }: { data: Overview }) {
  const [amount, setAmount] = useState('')
  const parsed = Number(amount)
  const valid = Number.isFinite(parsed) && parsed > 0
  const shareOfFund =
    valid && data.fund.totalCapital > 0n ? (parsed / (usdcNum(data.fund.totalCapital) + parsed)) * 100 : 0

  return (
    <Card elevated>
      <CardHeader title="Supply capital" right={<Pill tone="caution">Read only</Pill>} />
      <div className="px-5 py-5">
        <label className="eyebrow mb-2 block" htmlFor="amount">
          Amount
        </label>
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2.5 focus-within:border-primary/40">
          <input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="0.00"
            className="tnum w-full bg-transparent text-[18px] text-ink outline-none placeholder:text-faint"
          />
          <span className="eyebrow shrink-0">USDC</span>
        </div>

        <div className="mt-4 space-y-2 text-[12px]">
          <div className="flex justify-between">
            <span className="text-faint">Share of fund after deposit</span>
            <span className="tnum text-subtle">{valid ? `${shareOfFund.toFixed(2)}%` : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-faint">Deployed by</span>
            <span className="text-subtle">{data.judges.filter((j) => j.active).length} active judges</span>
          </div>
          <div className="flex justify-between">
            <span className="text-faint">Network</span>
            <span className="text-subtle">Arc testnet, gas in USDC</span>
          </div>
        </div>

        <button
          type="button"
          disabled
          className="mt-5 w-full cursor-not-allowed rounded-md bg-primary/30 px-4 py-2.5 text-[14px] font-semibold text-on-primary/60"
        >
          Deposit
        </button>
        <p className="mt-3 text-[12px] leading-relaxed text-faint">
          Not wired to a wallet yet. <span className="tnum text-subtle">depositCapital</span> is already permissionless
          onchain, so anyone can supply the fund today by calling it directly. This panel stays read only until the LP
          flow is built.
        </p>
      </div>

      <div className="border-t border-line px-5 py-3.5">
        <div className="eyebrow mb-2">Fund contract</div>
        <div className="flex items-center justify-between">
          <AddressChip addr={addresses.agenture.fund} />
          <a
            href={`${addresses.explorer}/address/${addresses.agenture.fund}`}
            target="_blank"
            rel="noreferrer"
            className="tnum text-[11px] text-primary hover:underline"
          >
            Arcscan ↗
          </a>
        </div>
      </div>
    </Card>
  )
}

function TermsCard() {
  return (
    <Card>
      <CardHeader title="What you are agreeing to" />
      <div className="space-y-4 px-5 py-5 text-[13px] leading-relaxed text-muted">
        <Term title="No human picks the deals">
          Capital is allocated by three agents with different theses, each signing from its own Circle wallet under a
          fixed mandate. There is no override.
        </Term>
        <Term title="Returns come from revenue share, not exits">
          Each deal carries a revenue share in basis points. When a startup earns, its cut streams back to the fund and
          is credited to the judge that backed it.
        </Term>
        <Term title="Withdrawal is not built yet">
          The Fund contract tracks supplied capital but issues no share token and has no withdraw path. Anything
          deposited today stays in. That is the honest state of the contract, and it is on the roadmap.
        </Term>
        <Term title="Testnet only">
          Arc testnet, unaudited, with testnet USDC. Nothing here is an offer or investment advice.
        </Term>
      </div>
    </Card>
  )
}

function Term({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="h-1 w-1 rounded-full bg-primary" />
        <span className="text-[13px] font-semibold text-ink">{title}</span>
      </div>
      <p className="pl-3 text-[12px] leading-relaxed text-faint">{children}</p>
    </div>
  )
}
